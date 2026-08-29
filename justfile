# Show available commands.
default:
    @just --list

# Install dependencies.
install:
    npm install

# Build the TypeScript project.
build:
    npm run build

# Run tests once.
test:
    npm test

# Check formatting and lint rules.
check:
    npm run check

# Apply Biome formatting and safe lint fixes.
fix:
    npm exec -- biome check --write .

# Synchronize the ignored Docusaurus checkout into the bundled skill corpus.
sync:
    npm run sync:blog

# Check whether the bundled corpus matches the ignored Docusaurus checkout.
sync-check:
    npm run sync:check

# Inspect the npm package contents without creating a tarball.
pack:
    npm pack --dry-run

# Run the same checks used by CI.
ci:
    npm run ci
