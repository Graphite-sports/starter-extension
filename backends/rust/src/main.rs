//! Backend of the starter extension. The Graphite server starts it once per event the extension is
//! installed in. PROTOCOL.md in the repository root describes the contract with the server.

use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::Write, path::PathBuf, process::ExitCode, sync::Arc, time::Duration};

/// Declared under `secrets` in extension.json, users set it in the engine.
const EXAMPLE_SECRET: &str = "example-token";

#[tokio::main]
async fn main() -> ExitCode {
    let args = match Args::parse(std::env::args().skip(1)) {
        Ok(args) => args,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    // Only reachable from this machine: users reach the backend through the server's proxy.
    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", args.port)).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("failed to bind 127.0.0.1:{}: {error}", args.port);
            return ExitCode::FAILURE;
        }
    };
    let port = listener.local_addr().expect("a bound listener has an address").port();
    // The handshake: the server waits up to 10 s for this as the first line on stdout.
    println!("PORT={port}");
    let _ = std::io::stdout().flush();
    // Everything printed after the handshake ends up in the extension log.
    println!("listening on 127.0.0.1:{port}, data dir {}", args.data_dir.display());

    let graphite = Arc::new(Graphite::new(&args));
    tokio::spawn(log_changes(graphite.clone()));
    let app = Router::new().route("/hello", get(hello)).with_state(graphite);
    if let Err(error) = axum::serve(listener, app).await {
        eprintln!("server failed: {error}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Hello {
    classes: Vec<Class>,
    example_token_is_set: bool,
}

/// `GET /hello`, reached through `…/extensions/starter-extension/backend/hello` on the server.
async fn hello(State(graphite): State<Arc<Graphite>>) -> Result<Json<Hello>, (StatusCode, String)> {
    let classes = graphite.classes().await.map_err(bad_gateway)?;
    // Never return or log a secret's value, only whether it is set.
    let example_token_is_set = graphite.secret(EXAMPLE_SECRET).await.map_err(bad_gateway)?.is_some();
    Ok(Json(Hello { classes, example_token_is_set }))
}

/// Logs every batch of the event's change stream and reconnects when the stream ends.
async fn log_changes(graphite: Arc<Graphite>) {
    loop {
        if let Err(error) = graphite.follow_changes().await {
            eprintln!("change stream failed: {error}");
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

/// Client for the Graphite REST API, scoped to the event this process was started for.
struct Graphite {
    client: reqwest::Client,
    event_url: String,
    identifier: String,
    api_key: String,
}

#[derive(Deserialize)]
struct ClassResponse {
    class: Class,
}

#[derive(Serialize, Deserialize)]
struct Class {
    /// A uuid; the backend only passes it on.
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct SecretValue {
    value: String,
}

impl Graphite {
    fn new(args: &Args) -> Self {
        Self {
            // The Graphite API is local, so never send its requests through a proxy.
            client: reqwest::Client::builder().no_proxy().build().expect("the TLS backend is available"),
            event_url: format!("{}/workspaces/{}/events/{}", args.graphite_url, args.workspace_id, args.event_id),
            identifier: args.identifier.clone(),
            api_key: args.api_key.clone(),
        }
    }

    async fn classes(&self) -> Result<Vec<Class>, reqwest::Error> {
        let classes: Vec<ClassResponse> = self.get("/classes").await?.error_for_status()?.json().await?;
        Ok(classes.into_iter().map(|response| response.class).collect())
    }

    /// `None` if the user has not set the secret.
    async fn secret(&self, name: &str) -> Result<Option<String>, reqwest::Error> {
        let response = self.get(&format!("/extensions/{}/secrets/{name}/value", self.identifier)).await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(response.error_for_status()?.json::<SecretValue>().await?.value))
    }

    /// Reads the server-sent events of `GET …/entity-changes` until the stream ends.
    async fn follow_changes(&self) -> Result<(), reqwest::Error> {
        let mut response = self.get("/entity-changes").await?.error_for_status()?;
        let (mut buffer, mut event, mut data) = (Vec::new(), String::new(), String::new());
        while let Some(chunk) = response.chunk().await? {
            buffer.extend_from_slice(&chunk);
            while let Some(end) = buffer.iter().position(|&byte| byte == b'\n') {
                let line: Vec<u8> = buffer.drain(..=end).collect();
                let line = String::from_utf8_lossy(&line);
                let line = line.trim_end_matches(['\r', '\n']);
                match line.split_once(':') {
                    Some(("event", value)) => event = value.trim_start().to_string(),
                    Some(("data", value)) => data.push_str(value.trim_start()),
                    // An empty line ends an event. Lines starting with `:` are keep-alive comments.
                    None if line.is_empty() => {
                        if event == "mutation" {
                            match serde_json::from_str::<Vec<serde_json::Value>>(&data) {
                                Ok(changes) => println!("received {} entity changes", changes.len()),
                                Err(error) => eprintln!("unexpected change batch: {error}"),
                            }
                        }
                        event.clear();
                        data.clear();
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }

    /// Every request to the Graphite API authenticates with the api key of this process.
    async fn get(&self, path: &str) -> Result<reqwest::Response, reqwest::Error> {
        self.client.get(format!("{}{path}", self.event_url)).header("x-api-key", &self.api_key).send().await
    }
}

fn bad_gateway(error: reqwest::Error) -> (StatusCode, String) {
    eprintln!("Graphite API request failed: {error}");
    (StatusCode::BAD_GATEWAY, format!("Graphite API request failed: {error}"))
}

/// The flags and environment the server starts the backend with, see PROTOCOL.md.
struct Args {
    graphite_url: String,
    workspace_id: String,
    event_id: String,
    identifier: String,
    /// From `GRAPHITE_API_KEY`, not a flag, so it does not show up in the process list.
    api_key: String,
    data_dir: PathBuf,
    /// Not passed by the server: lets a developer pick the port of a dev extension.
    port: u16,
}

impl Args {
    /// Flags have the form `--name=value`. Unknown ones are ignored, so newer servers can add flags.
    fn parse(args: impl Iterator<Item = String>) -> Result<Self, String> {
        let mut flags: HashMap<String, String> = args
            .filter_map(|arg| {
                let (name, value) = arg.strip_prefix("--")?.split_once('=')?;
                Some((name.to_string(), value.to_string()))
            })
            .collect();
        let port = match flags.remove("port") {
            Some(port) => port.parse().map_err(|_| format!("--port={port} is not a port number"))?,
            None => 0,
        };
        let mut flag = |name: &str| flags.remove(name).ok_or_else(|| format!("missing flag --{name}=<value>"));
        Ok(Self {
            graphite_url: flag("graphite-url")?,
            workspace_id: flag("workspace-id")?,
            event_id: flag("event-id")?,
            identifier: flag("identifier")?,
            api_key: std::env::var("GRAPHITE_API_KEY")
                .map_err(|_| "missing environment variable GRAPHITE_API_KEY=<api key>".to_string())?,
            data_dir: flag("data-dir")?.into(),
            port,
        })
    }
}
