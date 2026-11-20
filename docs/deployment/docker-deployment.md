# Docker deployment (Windows Docker Desktop or Linux)

Status: **prepared, not yet executed.** No image has been built and no container
has run. Verify every step on the target host. Access is HTTPS only, through
Nginx Proxy Manager (NPM). Plaintext HTTP is never published.

## Package

| Service    | Image / build                            | Networks                           | Persistent data                                          |
| ---------- | ---------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| `postgres` | `postgres:18.6-bookworm`                 | database (internal)                | `postgres_data`                                          |
| `api`      | `Dockerfile` target `runtime`            | database, app, scanner, egress     | `private_files`, `erasure_control`, `shared_control`     |
| `worker`   | same image, `node dist/worker.js`        | database, scanner, egress          | the same three volumes                                   |
| `web`      | `../planner/Dockerfile` (Next.js)        | app (internal)                     | none                                                     |
| `proxy`    | `jc21/nginx-proxy-manager:2.12.6`        | app (fixed `172.30.240.10`), edge  | `npm_data`, `npm_letsencrypt`                            |
| `clamav`   | `clamav/clamav:1.4.3` (overlay)          | scanner (internal), clamav_updates | `clamav_signatures`                                      |
| `migrate`  | `Dockerfile` target `ops`, profile `ops` | database                           | none, one-shot                                           |
| `ops`      | same, profile `ops`                      | database, scanner                  | the three private volumes, plus `BACKUP_DIR` → `/backup` |

- Published ports:
  - `PROXY_BIND:PROXY_HTTPS_PORT → 443`. The default is `127.0.0.1:443`.
  - The NPM admin UI on `127.0.0.1:NPM_ADMIN_PORT → 81`. It is always loopback only.

  Nothing else is published: not PostgreSQL, the API, the worker, ClamAV or port 80.

- The API and worker use absolute, independent sibling roots:
  - `STORAGE_ROOT=/var/lib/mehran/files`
  - `ERASURE_CONTROL_ROOT=/var/lib/mehran/erasure-control`
  - `SHARED_CONTROL_ROOT=/var/lib/mehran/shared-control`

  Each is a named volume owned by `node` (uid 1000) with mode 0700.

- **Client IP:** the API sets `TRUSTED_PROXY_ADDRESSES=172.30.240.10` (NPM only).
  Express resolves `req.ip` from `X-Forwarded-For` only when the connecting peer
  is NPM, and NPM overwrites that header with its own peer address. Better Auth,
  the Throttler limits and the Shared rate limits all key on that address.
  Forged headers from any other peer are ignored.
  NPM's global `nginx.conf` trusts `X-Real-IP` from every private range
  (`10/8`, `172.16/12`, `192.168/16`). That would let a LAN client, or the
  Docker Desktop host gateway, choose its own address. The Planner advanced
  config therefore sets `set_real_ip_from 127.0.0.1/32;`. At server level this
  replaces the inherited list, so NPM trusts no forwarded hop and
  `$remote_addr` stays the real peer. Never remove it.
- Migrations never run on startup. If they have not been applied, the API
  refuses to start (pg-boss schema verification).
- Always use the wrapper. It adds the operator env file and the ClamAV overlay:
  - Windows PowerShell: `$P = ".\deploy\planner-compose.ps1"`, then `& $P <args>`.
    The env file is `%LOCALAPPDATA%\mehran-planner\planner.env`.
  - Linux: `P="sh deploy/planner-compose.sh"`, then `$P <args>`. The env file is
    `/etc/mehran-planner/planner.env`.

  The examples below use the Linux form. On Windows, write `& $P …` instead.

## 1. Prerequisites

**Windows** (requires approval to install system software):

1. Windows 11 with hardware virtualization enabled in the BIOS/UEFI.
2. WSL2. In an elevated PowerShell, run `wsl --install`, then reboot.
3. Docker Desktop 4.x (Linux containers, WSL2 backend), from
   <https://docs.docker.com/desktop/setup/install/windows-install/>. Start it
   and check `docker version` and `docker compose version` (v2.24 or later).
4. Free local port 443, or set `PROXY_HTTPS_PORT=8443` and add `:8443` to
   `BETTER_AUTH_URL` and `CORS_ORIGINS`.
5. At least 8 GB of RAM available to WSL2 (ClamAV alone uses up to about 3 GB).
   Docker Desktop must have file sharing for `D:\New folder`.

**Linux (Ubuntu 24.04):** install Docker Engine and the Compose plugin from
Docker's apt repository (`docker-ce docker-ce-cli containerd.io
docker-buildx-plugin docker-compose-plugin`). Clone both repositories side by
side, for example `/opt/mehran/planner-backend` and `/opt/mehran/planner`.
Docker-published ports bypass UFW, so bind `PROXY_BIND` to the private or VPN IP.

The images are built from the working trees of both repositories, so check out
the intended branch before building. On Windows these are the existing
checkouts under `D:\New folder`.

## 2. Secrets and env file (operator-supplied, never committed)

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\mehran-planner" | Out-Null
Copy-Item .env.compose.example "$env:LOCALAPPDATA\mehran-planner\planner.env"
```

Linux: `sudo install -d -m 750 /etc/mehran-planner && sudo install -m 600 -o "$USER" .env.compose.example /etc/mehran-planner/planner.env`.

Generate values with OpenSSL. Use Git Bash on Windows. Paste each value into
the env file and never print it into shared logs:

| Setting                                     | Value                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                         | `openssl rand -hex 32`. Use the same value in `DOCKER_DATABASE_URL`.                            |
| `BETTER_AUTH_SECRET`                        | `openssl rand -base64 48`                                                                       |
| `SMTP_PASSWORD`                             | A **newly rotated** Resend API key. Revoke the exposed key first.                               |
| `MAIL_FROM`                                 | An address on a Resend-verified domain, or `onboarding@resend.dev` until one exists (see Email) |
| `PERSONAL_EVIDENCE_KEYS` / `_ACTIVE_KEY_ID` | Output of the first command below (recommended from the first start)                            |
| `SHARED_CONTROL_KEYS` / `_ACTIVE_KEY_ID`    | Output of the second command below. This does not activate Shared features.                     |
| `PUSH_*`                                    | See Browser Push                                                                                |
| `PERSONAL_ERASURE_POLICY_VERSION`           | Only an owner-approved version. Leave it unset otherwise.                                       |
| `SHARED_SECURITY_ACCEPTANCE_REFERENCE`      | Only the owner's genuine acceptance reference. Leave it unset otherwise.                        |

```sh
k() { openssl rand -hex 32; }
printf "PERSONAL_EVIDENCE_KEYS='{\"pe1\":{\"control\":\"%s\",\"identity\":\"%s\",\"backup\":\"%s\",\"capability\":\"%s\"}}'\nPERSONAL_EVIDENCE_ACTIVE_KEY_ID=pe1\n" "$(k)" "$(k)" "$(k)" "$(k)"
printf "SHARED_CONTROL_KEYS='{\"sc1\":\"%s\"}'\nSHARED_CONTROL_ACTIVE_KEY_ID=sc1\n" "$(k)"
```

Optional settings stay commented out (`#NAME=`) until they have a real value,
because empty values fail validation. Keep every key ID that ever signed
evidence. Store the env file in a password manager. Backups are useless without
the keys. Never use a Windows host database: `DOCKER_DATABASE_URL` must point at
`postgres:5432`.

## 3. Build, migrate, start

```sh
$P config --quiet
$P build
$P up -d postgres
$P run --rm migrate          # prisma migrate deploy (110 reviewed migrations), then pg-boss schema
$P run --rm --no-deps ops    # configuration check (values withheld)
$P run --rm --no-deps ops node tooling/scripts/personal-data-admin.ts init-control   # once per new installation
$P up -d
$P ps
```

The first ClamAV start downloads about 300 MB of signatures and can take up to
30 minutes. Until then, file uploads and downloads fail closed.

Day-2 commands:

- `$P logs -f --tail=200 api worker`
- `$P stop` and `$P start`
- `$P restart api worker`
- `$P down`. This keeps the volumes. **Never** use `down -v`.

Update:

1. Pull both repositories.
2. Take a backup (section 7).
3. Run `$P build`, then `$P run --rm migrate`, then `$P up -d`.

Migration status:
`$P run --rm migrate node node_modules/prisma/build/index.js migrate status --config prisma.config.ts`.
The history ends at `202611190084_company_team_project_recovery_window` and
`202611190085_malware_scan_verdicts`. Never run `migrate dev`, `migrate reset`
or `db push`.

## 4. Private HTTPS certificate and Nginx Proxy Manager

1. **Certificate.** Run this in Git Bash on Windows or a shell on Linux. Keep
   the output outside the repository:
   - Local: `sh deploy/tls/make-private-cert.sh "$HOME/mehran-planner-tls-planner" planner.localhost localhost 127.0.0.1`
   - Server: `sh deploy/tls/make-private-cert.sh ~/mehran-planner-tls <private-hostname> <server-private-ip>`

   Let's Encrypt cannot issue certificates for `*.localhost` or a bare IP, so
   do not use it until a domain exists.

   **The NPM `localhost` catch-all limitation.** NPM 2.12.6 ships
   `/etc/nginx/conf.d/default.conf`, which defines the first 443 server with
   `server_name localhost` and `ssl_reject_handshake on`. It loads before any
   proxy host, so a proxy host named `localhost` is never selected (TLS alert
   "unrecognized name"). Connections without SNI, such as `https://<bare-IP>`,
   also land on that server and are rejected. Therefore:
   - Locally, use **`https://planner.localhost`**. Browsers resolve every
     `*.localhost` name to loopback, and it is a secure context. Command-line
     tools may need `--resolve planner.localhost:443:127.0.0.1`.
   - On a server, use a hostname (local DNS or a hosts-file entry pointing at
     the private IP), not a bare IP.
   - Do not edit NPM's built-in files or add hidden `custom/*.conf` server
     blocks to work around this.

2. **Trust `ca.crt`** on every client device:
   - Windows: `Import-Certificate -FilePath "$HOME\mehran-planner-tls-planner\ca.crt" -CertStoreLocation Cert:\CurrentUser\Root`
     (confirm the Windows security prompt)
   - Firefox: also set `security.enterprise_roots.enabled=true`.
   - macOS, Android and iOS: import it as a trusted root CA.
3. **Open the NPM admin UI.** It is loopback only:
   - Local: <http://127.0.0.1:81>
   - Server: `ssh -L 8181:127.0.0.1:81 user@server`, then <http://127.0.0.1:8181>.

   Log in with NPM's default first-run account (`admin@example.com` / `changeme`),
   then **immediately** set a strong unique email and password.

4. **Add the certificate.** Go to SSL Certificates → Add SSL Certificate →
   Custom. Upload `server.key` as the Certificate Key and `server.crt` as the
   Certificate.
5. **Add the proxy host.** Go to Hosts → Proxy Hosts → Add:
   - Details tab:
     - Domain Names: `planner.localhost`, or the server's private hostname.
       Never use `localhost` or a bare IP (see the limitation above).
     - Scheme: `http`. Forward Hostname: `web`. Forward Port: `3000`.
     - Enable Block Common Exploits. Leave Cache Assets off.
   - SSL tab: the custom certificate, with Force SSL and HTTP/2 on. Leave HSTS
     off while there is no domain.
   - Advanced tab: paste [`deploy/nginx-proxy-manager/planner-advanced.conf`](../../deploy/nginx-proxy-manager/planner-advanced.conf).
     It routes `/api/` to `api:3000`, overwrites forwarded IPs, disables
     NPM's private-range `X-Real-IP` trust, blocks `/health/` and sets the body
     limit.
6. **Do not create** any proxy host for `api`, `postgres`, `clamav` or the
   admin port. Do not publish port 80.
7. **Verify:**
   - `curl --cacert ~/mehran-planner-tls-planner/ca.crt --resolve planner.localhost:443:127.0.0.1 https://planner.localhost/` should return HTML.
   - `…/api/v1/auth/get-session` should return JSON.
   - `…/health/ready` should return `404`.
   - `…/sw.js` should return JavaScript with `Cache-Control: no-cache`.

`BETTER_AUTH_URL` and `CORS_ORIGINS` must exactly match the URL in the browser,
including the port if it is not 443.

## 5. Health and smoke checks

```sh
$P ps                                   # api, web, proxy, postgres, clamav "healthy"; worker "running"
$P exec api node -e "fetch('http://127.0.0.1:3000/health/ready').then(async r=>console.log(r.status,await r.text()))"
$P logs --tail=50 worker                # pg-boss started, no configuration errors
$P exec clamav clamdcheck.sh && echo clamd-ok
$P run --rm --no-deps ops node deploy/clamav/smoke.mjs   # clean=CLEAN eicar=INFECTED
```

End-to-end ClamAV test in the app:

1. Sign in and upload a small text file. It should succeed.
2. Upload an EICAR test file. It must be rejected. Create it on the client with
   this command, which is split so that no repository file contains the
   signature:
   `printf '%s%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS' '-TEST-FILE!$H+H*' > eicar.txt`

After a signature update, run
`$P run --rm --no-deps ops node tooling/scripts/malware-rescan.ts --unverified`.

Persistence check:

1. Run `$P restart` and confirm the uploaded file and your account still exist.
2. Run `$P down` then `$P up -d`. The volumes must survive.

## 6. Email (Resend SMTP) and Browser Push

**Email:**

- Production mode accepts **only** `MAIL_MODE=smtp`. The configuration
  validator rejects sink mode, and this package does not bypass that.
- No sender domain is verified yet. Set `MAIL_FROM=onboarding@resend.dev`.
  Resend then delivers **only to the Resend account owner's own address**.
- Sign-up requires email verification, so only that address can complete
  sign-up. Keep `NOTIFICATION_EMAIL_ENABLED=false`.
- Test by signing up with the owner address and confirming that the
  verification mail arrives. Then check `$P logs worker api` for SMTP errors.
- After a domain is verified (SPF and DKIM), set `MAIL_FROM` to an address on
  that domain and run `$P up -d api worker`.

**Browser Push** (the existing frontend Service Worker and API adapter):

1. Generate the keys:
   `$P run --rm --no-deps --entrypoint node api -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"`
2. Set `PUSH_MODE=webpush`, `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`
   and `PUSH_VAPID_SUBJECT=mailto:<operator>`. Then run `$P up -d api worker`.
3. Push requires a secure context: an HTTPS origin with a certificate the
   device trusts, which means the CA from section 4. Test it by enabling
   notifications in the app's notification settings and triggering a reminder.
   Outbound HTTPS from `api` and `worker` (the `egress` network) must be allowed.

## 7. Backup and restore

The scripts are POSIX `sh` and need a Linux shell. On Windows, run them from a
WSL2 distro with Docker Desktop WSL integration enabled. Set
`PLANNER_ENV_FILE=/mnt/c/Users/<you>/AppData/Local/mehran-planner/planner.env`.

```sh
sudo -E sh deploy/backup.sh                                     # verified backup in /var/backups/mehran-planner/<stamp>
sudo -E sh deploy/restore-verify.sh /var/backups/mehran-planner/<stamp>   # isolated throwaway restore
```

The backup stops `api` and `worker` briefly so the snapshot is consistent. It
writes:

- `planner.dump`, a `pg_dump -Fc`
- `files.tar.gz`, the private files
- `control.tar.gz`, the independent control roots
- `manifest.json`, a signed manifest that expires after 30 days, and `SHA256SUMS`

Then it verifies them. Copy each backup to storage **outside this machine**.

A **live restore is destructive.** It needs explicit owner approval and has not
been rehearsed:

1. Stop `api` and `worker`.
2. Restore the dump and the files from the same stamp.
3. Never roll back the control roots unless they are lost.
4. Run `$P run --rm --no-deps ops node tooling/scripts/personal-data-admin.ts restore-replay /backup/<stamp>/manifest.json /backup/<stamp>`.
5. Start the services only after the replay passes.

## 8. Retention and Shared activation (unchanged, approvals required)

Recovery windows:

- Personal account deletion: 7-day grace period
- Company, Team and Project: 7 days (ADR 0029 amendment, migration 0084)
- Social Group: 30 days (ADR 0066/0067)
- Conversation and Meeting: 30 days

Other policies are unchanged.

Before enabling restricted Shared features, all of the following are required
from the owner. None may be invented:

1. `SHARED_SECURITY_ACCEPTANCE_REFERENCE`: the owner's genuine documented
   security acceptance. `SHARED_CONTROL_KEYS` and `SHARED_CONTROL_ACTIVE_KEY_ID`
   must also be set. Until then, Shared features return
   `SHARED_ACTIVATION_GATED`. Never set `SHARED_LOCAL_DEVELOPMENT_TEST_MODE`.
2. **Retention policy approval.** The Retention Catalog v1.0 seed is approved
   for development and pre-production only. Production use needs written
   approval from the owner and the accountable operator. The Company finance
   policy is waiting on legal review. Its immutable policy versions declare a
   30-day `sharedRecoverySeconds`, and any new version needs separate approval.
3. `PERSONAL_ERASURE_POLICY_VERSION`: an owner-approved version. It is baked
   into the web build, so rebuild `web` after changing it. Until it is set,
   account deletion returns `ERASURE_POLICY_UNAVAILABLE`.

## 9. Troubleshooting

| Symptom                                          | Check                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid configuration: <keys>`                  | Run `$P run --rm --no-deps ops` and fix the named keys. Values are withheld. An empty optional value also fails, so comment it out.                     |
| `production requires HTTPS origins and SMTP`     | Origins must be `https://…`, and the SMTP settings must be complete.                                                                                    |
| API unhealthy after an update                    | Run `$P run --rm migrate`.                                                                                                                              |
| `TRUSTED_PROXY_ADDRESSES` invalid                | Only explicit IPs or CIDRs are accepted (no `true`, hop counts, names or `/0`).                                                                         |
| Every user is rate-limited together              | Check the NPM Advanced config is applied and that `proxy` has `172.30.240.10` (`docker network inspect mehran-planner_app`).                            |
| `Pool overlaps with other one on this host`      | Another network uses `172.30.240.0/24`. Change the subnet, the proxy `ipv4_address` and `TRUSTED_PROXY_ADDRESSES` together.                             |
| Port 443 or 81 already in use (Windows)          | Change `PROXY_HTTPS_PORT` (and the origins) or `NPM_ADMIN_PORT`.                                                                                        |
| TLS alert "unrecognized name" / connection reset | The proxy host is named `localhost` or a bare IP, which NPM's built-in catch-all rejects. Use `planner.localhost` or a hostname.                        |
| Browser certificate warning                      | The CA is not trusted on that device, or the certificate's names do not match the URL.                                                                  |
| Cookies lost or `403` on POST                    | The browser URL must exactly match `BETTER_AUTH_URL` and `CORS_ORIGINS`.                                                                                |
| NPM shows the proxy host offline                 | Check `$P logs proxy`. The `api` and `web` services must be healthy.                                                                                    |
| Upload scanner error                             | ClamAV is not healthy yet, or its signatures are stale. Check `$P logs clamav`.                                                                         |
| `413` on upload                                  | Raise `client_max_body_size` in the NPM Advanced config (and `FILE_MAX_BYTES` within the approved limit).                                               |
| `EACCES` on volumes                              | The volumes must be owned by uid 1000. Take a backup first, then run `docker run --rm -v mehran-planner_private_files:/d alpine chown -R 1000:1000 /d`. |
| `EROFS` in `web` logs                            | Report it. As a temporary measure, remove `read_only` from `web`.                                                                                       |
| No verification email                            | Expected for anyone other than the Resend owner address until a domain is verified.                                                                     |
