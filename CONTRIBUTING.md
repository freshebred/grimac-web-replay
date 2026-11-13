# Contributing

Use a supported Node 22+ runtime and Java 25. Install web/server dependencies using `npm run setup`, run `npm test`, `npm run build`, and build the recorder with `cd mod && ./gradlew build`.

Keep protocol compatibility explicit. Update docs/protocol.md and all producers/consumers when changing the format. New schema versions must fail clearly on old readers. Add tests for authentication, expiry, malformed evidence, coordinate ordering, and timeline behavior when changing those paths.

Do not commit credentials, real player recordings, dependencies, or runtime data. The test fixture generator creates synthetic evidence. Claims about game performance require benchmark measurements; passing unit tests is not evidence of low gameplay overhead.

Keep the dashboard focused on investigation: no marketing sections or decorative copy. Use accessible labels and keyboard controls. Preserve local-only file import.
