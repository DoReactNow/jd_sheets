//! Starts the collab service on COLLAB_HOST:COLLAB_PORT (default host 127.0.0.1).
use std::collections::HashMap;
use std::net::SocketAddr;

use jd_collab::config::Config;
use jd_collab::http::{AppState, router};

/// `jd-collab --healthcheck`: exits 0 when the local service answers /health (Docker HEALTHCHECK;
/// the runtime image has no curl).
fn healthcheck() -> i32 {
    use std::io::{Read, Write};
    let port = std::env::var("COLLAB_PORT").unwrap_or_else(|_| "47321".into());
    let Ok(mut stream) = std::net::TcpStream::connect(format!("127.0.0.1:{port}")) else {
        return 1;
    };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
    if stream
        .write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        .is_err()
    {
        return 1;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    if response.starts_with("HTTP/1.0 200") || response.starts_with("HTTP/1.1 200") {
        0
    } else {
        1
    }
}

#[tokio::main]
async fn main() {
    if std::env::args().any(|arg| arg == "--healthcheck") {
        std::process::exit(healthcheck());
    }
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_env("COLLAB_LOG").unwrap_or_else(|_| "info".into()))
        .init();

    let vars: HashMap<String, String> = std::env::vars().collect();
    let config = match Config::from_env(&vars) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("collab service: invalid configuration: {error}");
            std::process::exit(1);
        }
    };
    let address = SocketAddr::new(config.host, config.port);
    let state = AppState::new(config);
    jd_collab::ws::start_background(&state);
    let listener = match tokio::net::TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("collab service: cannot listen on {address}: {error}");
            std::process::exit(1);
        }
    };
    tracing::info!(%address, "collab service listening");
    let app = router(state).into_make_service_with_connect_info::<SocketAddr>();
    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    if let Err(error) = axum::serve(listener, app).with_graceful_shutdown(shutdown).await {
        eprintln!("collab service stopped: {error}");
        std::process::exit(1);
    }
}
