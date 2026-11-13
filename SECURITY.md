# Security

Do not post credentials or private evidence in public issues. Report a suspected vulnerability privately to the repository maintainer using GitHub private vulnerability reporting when enabled.

Only configured Discord user IDs may read evidence or administer the web app. Ingest tokens are write credentials held by trusted game server operators. Never distribute them to players or browser code. Use TLS and keep the API behind the supplied reverse proxy. Public paste services are not private evidence stores.

Replay imports are untrusted data. The app validates file sizes and geometry counts; rendering uses generic assets and treats logs as text. A downloaded replay contains world coordinates and player movement. Store and share it deliberately.

Changing the Discord allowlist requires recreating the API container. Sessions are opaque random tokens stored as hashes in SQLite. Remove access before redistributing a token. Keep the filesystem containing evidence and the application environment readable only to the service/operator.
