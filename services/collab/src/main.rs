//! Starts the collab service on COLLAB_HOST:COLLAB_PORT (default host 127.0.0.1).
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use jd_collab::config::Config;
use jd_collab::http::{AppState, router};

#[tokio::main]
async fn main() {
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
    let state = AppState {
        config: Arc::new(config),
    };
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
