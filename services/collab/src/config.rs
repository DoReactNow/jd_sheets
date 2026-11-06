//! Configuration from the environment, with the same refusals as the app's env loader
//! (P0-ENV-04): a test run needs a `_test` database; production refuses development
//! placeholders and test databases. Defaults equal the app's appConfig.ts (P0-RUST-03).
use std::collections::HashMap;
use std::net::IpAddr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppEnv {
    Development,
    Test,
    Production,
}

/// Limits and token rules shared with the app (contracts/app-config.json).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Limits {
    pub workbook_max_bytes: u64,
    /// Largest total uncompressed size a workbook archive may declare (ZIP bomb guard).
    pub max_uncompressed_bytes: u64,
    pub max_archive_entries: usize,
    pub token_ttl_seconds: u64,
    pub token_leeway_seconds: u64,
    pub token_issuer: String,
    pub token_audience: String,
    /// How long one workbook may take to validate before it is refused.
    pub validate_timeout_seconds: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            workbook_max_bytes: 50 * 1024 * 1024,
            max_uncompressed_bytes: 1024 * 1024 * 1024,
            max_archive_entries: 20_000,
            token_ttl_seconds: 300,
            token_leeway_seconds: 30,
            token_issuer: "jd-sheets-app".into(),
            token_audience: "jd-sheets-collab".into(),
            validate_timeout_seconds: 15,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub app_env: AppEnv,
    pub host: IpAddr,
    pub port: u16,
    pub database_name: String,
    pub collab_token_secret: String,
    pub internal_service_token: String,
    pub trusted_proxy_hops: usize,
    /// Where the app's internal routes are (live editing, Decision 58): APP_INTERNAL_URL, else APP_URL.
    pub app_url: String,
    pub limits: Limits,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("{0}")]
pub struct ConfigError(pub String);

const PLACEHOLDER_MARKERS: [&str; 3] = ["dev-only", "test-only", "change-me"];

fn is_placeholder(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    PLACEHOLDER_MARKERS.iter().any(|marker| lower.contains(marker))
}

/// The database name of a postgresql:// URL (the path after the host), without query.
fn database_name(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("postgresql://")
        .or_else(|| url.strip_prefix("postgres://"))?;
    let path = rest.split_once('/')?.1;
    let name = path.split('?').next()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

impl Config {
    pub fn from_env(vars: &HashMap<String, String>) -> Result<Config, ConfigError> {
        let get = |name: &str| vars.get(name).map(|v| v.trim()).filter(|v| !v.is_empty());
        let required = |name: &str| get(name).ok_or_else(|| ConfigError(format!("{name} is required")));

        let app_env = match required("APP_ENV")? {
            "development" => AppEnv::Development,
            "test" => AppEnv::Test,
            "production" => AppEnv::Production,
            _ => return Err(ConfigError("APP_ENV must be development, test or production".into())),
        };
        let host: IpAddr = get("COLLAB_HOST")
            .unwrap_or("127.0.0.1")
            .parse()
            .map_err(|_| ConfigError("COLLAB_HOST must be an IP address".into()))?;
        let port: u16 = required("COLLAB_PORT")?
            .parse()
            .map_err(|_| ConfigError("COLLAB_PORT must be a port number".into()))?;
        let database_name = database_name(required("DATABASE_URL")?)
            .ok_or_else(|| ConfigError("DATABASE_URL must be a postgresql:// URL with a database name".into()))?;
        let secret = |name: &str| -> Result<String, ConfigError> {
            let value = required(name)?;
            if value.len() < 32 {
                return Err(ConfigError(format!("{name} must be at least 32 characters")));
            }
            if app_env == AppEnv::Production && is_placeholder(value) {
                return Err(ConfigError(format!(
                    "{name} is a development placeholder; generate a real secret"
                )));
            }
            Ok(value.to_string())
        };
        let collab_token_secret = secret("COLLAB_TOKEN_SECRET")?;
        let internal_service_token = secret("INTERNAL_SERVICE_TOKEN")?;
        let trusted_proxy_hops = match get("TRUSTED_PROXY_HOPS") {
            None => 0,
            Some(value) => value
                .parse::<usize>()
                .ok()
                .filter(|hops| *hops <= 5)
                .ok_or_else(|| ConfigError("TRUSTED_PROXY_HOPS must be a number from 0 to 5".into()))?,
        };

        let is_test_db = database_name.ends_with("_test");
        if app_env == AppEnv::Test && !is_test_db {
            return Err(ConfigError(format!(
                "Refusing to run: APP_ENV=test needs a database whose name ends in _test (got \"{database_name}\")."
            )));
        }
        if app_env == AppEnv::Production && is_test_db {
            return Err(ConfigError(format!(
                "Refusing to run: APP_ENV=production cannot use a test database (got \"{database_name}\")."
            )));
        }

        let app_url = get("APP_INTERNAL_URL")
            .or_else(|| get("APP_URL"))
            .unwrap_or("http://127.0.0.1:47320")
            .trim_end_matches('/')
            .to_string();

        Ok(Config {
            app_env,
            host,
            port,
            database_name,
            collab_token_secret,
            internal_service_token,
            trusted_proxy_hops,
            app_url,
            limits: Limits::default(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        let mut map: HashMap<String, String> = [
            ("APP_ENV", "development"),
            ("COLLAB_PORT", "47321"),
            ("DATABASE_URL", "postgresql://u:p@127.0.0.1:47322/jdsheets_dev"),
            ("COLLAB_TOKEN_SECRET", "dev-only-collab-secret-change-me-0123456789"),
            ("INTERNAL_SERVICE_TOKEN", "dev-only-internal-token-change-me-0123456789"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        for (k, v) in pairs {
            map.insert(k.to_string(), v.to_string());
        }
        map
    }

    #[test]
    fn parses_a_development_environment() -> Result<(), ConfigError> {
        let config = Config::from_env(&vars(&[]))?;
        assert_eq!(config.app_env, AppEnv::Development);
        assert_eq!(config.port, 47321);
        assert_eq!(config.host.to_string(), "127.0.0.1");
        assert_eq!(config.database_name, "jdsheets_dev");
        Ok(())
    }

    #[test]
    fn test_runs_need_a_test_database() {
        let error = Config::from_env(&vars(&[("APP_ENV", "test")]));
        assert!(matches!(error, Err(ConfigError(message)) if message.contains("_test")));
        let ok = Config::from_env(&vars(&[
            ("APP_ENV", "test"),
            (
                "DATABASE_URL",
                "postgresql://u:p@127.0.0.1:47322/jdsheets_test?schema=public",
            ),
        ]));
        assert!(ok.is_ok());
    }

    #[test]
    fn production_refuses_placeholders_and_test_databases() {
        let prod = |extra: &[(&str, &str)]| {
            let mut all = vec![
                ("APP_ENV", "production"),
                ("DATABASE_URL", "postgresql://u:p@db:5432/jdsheets"),
                ("COLLAB_TOKEN_SECRET", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
                ("INTERNAL_SERVICE_TOKEN", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
            ];
            all.extend_from_slice(extra);
            Config::from_env(&vars(&all))
        };
        assert!(prod(&[]).is_ok());
        assert!(prod(&[("COLLAB_TOKEN_SECRET", "dev-only-collab-secret-change-me-0123456789")]).is_err());
        assert!(prod(&[("DATABASE_URL", "postgresql://u:p@db:5432/jdsheets_test")]).is_err());
    }

    #[test]
    fn missing_or_short_values_name_the_variable_but_not_the_value() {
        let mut missing = vars(&[]);
        missing.remove("COLLAB_PORT");
        assert_eq!(
            Config::from_env(&missing).err(),
            Some(ConfigError("COLLAB_PORT is required".into()))
        );
        let short = Config::from_env(&vars(&[("COLLAB_TOKEN_SECRET", "short-secret")]));
        let message = short.err().map(|e| e.0).unwrap_or_default();
        assert!(message.contains("COLLAB_TOKEN_SECRET"));
        assert!(!message.contains("short-secret"));
    }

    #[test]
    fn rejects_bad_values() {
        assert!(Config::from_env(&vars(&[("APP_ENV", "staging")])).is_err());
        assert!(Config::from_env(&vars(&[("COLLAB_PORT", "99999")])).is_err());
        assert!(Config::from_env(&vars(&[("COLLAB_HOST", "localhost")])).is_err());
        assert!(Config::from_env(&vars(&[("DATABASE_URL", "mysql://x/y")])).is_err());
        assert!(Config::from_env(&vars(&[("TRUSTED_PROXY_HOPS", "9")])).is_err());
    }
}
