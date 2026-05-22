## Describe your changes
A brief summary of what you implemented, fixed, or updated.

## Monorepo Areas Changed
Check all that apply:
- [ ] Go Signaling Backend (`/backend`)
- [ ] Next.js Frontend (`/frontend`)
- [ ] Infrastructure Configurations (`/infrastructure`)
- [ ] Documentation (`/docs` or markdown files)

## Verifications Performed
Please detail how you tested and verified your changes:
1. **TypeScript Checks**: Did you run `npx tsc --noEmit` inside `/frontend`? (Must compile with zero errors)
2. **Go Builds**: Did you verify that `go build ./...` compiles cleanly?
3. **Internal Tests**: Did all Go test suits pass (`go test -v -race ./...`)?
4. **Manual Flow**: Describe how you verified connection/transfer loops between separate browser tabs.

## Security Review Checklist
- [ ] No private or derived session keys are leaked to logs or console outputs.
- [ ] Direct P2P transfer paths remain completely out of the signaling server's plaintext reach.
- [ ] All new Web Crypto API inputs/outputs have been strictly typed.
- [ ] No third-party dependencies with weak cryptographic profiles have been introduced.
