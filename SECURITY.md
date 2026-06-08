# Security Policy

## Supported Versions

Only the latest release of ShadowChat is actively supported with security updates. We recommend always running the latest tag in production.

| Version | Supported |
| ------- | --------- |
| v1.x.x  | ✅ Yes    |
| < v1.0  | ❌ No     |

## Zero-Knowledge Threat Model

ShadowChat assumes a **compromised or malicious signaling server** environment. The system design strictly enforces:
- **Server Blindness**: The server must never see plaintext file content, plaintext room chat, or private/secret keys.
- **Ephemerality**: All signaling metadata (SDP/ICE) must remain short-lived and non-persistent.
- **Client-Side Key Distribution**: Keys are passed through the URL hash fragment (`#key=...`), which modern browsers do not transmit over the network to the host server.

Any vulnerability that allows the signaling server to decrypt message payloads, capture keys, or circumvent browser-based Web Crypto isolations is classified as a **Critical Vulnerability**.

## Reporting a Vulnerability

Please do **NOT** open public issues for security vulnerabilities. Instead, report security vulnerabilities by emailing the security team or the project maintainers directly.

Please report vulnerabilities via GitHub Security Advisories: https://github.com/paultanay/shadowchat/security/advisories/new

When reporting, please include:
1. A clear description of the vulnerability.
2. A proof of concept (PoC) or step-by-step instructions to reproduce.
3. The potential impact under our zero-knowledge threat model.

We will acknowledge your report within 48 hours and work with you to coordinate a security advisory and patch.
