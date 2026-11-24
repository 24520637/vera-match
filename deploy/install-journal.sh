#!/usr/bin/env bash
set -euo pipefail
# New-host installation only. Does not buy hosting, provision TLS or overwrite keys.
if [[ ${EUID} -ne 0 || $# -ne 1 || $1 != /* ]]; then
  echo 'Run as root: bash deploy/install-journal.sh /absolute/generated/server' >&2
  exit 1
fi
config_source=$1
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ $(node -p "process.versions.node.split('.')[0]") == 24 ]] || { echo 'Install Node.js 24 first' >&2; exit 1; }
[[ -x /usr/bin/node ]] || { echo 'Adapt the service Node.js path before installing' >&2; exit 1; }
for required in server.json signing-private.pem api-token; do
  [[ -f "$config_source/$required" && ! -L "$config_source/$required" ]] || { echo 'Incomplete generated server configuration' >&2; exit 1; }
done
for protected in /etc/vera-journal /var/lib/vera-journal /srv/vera-journal; do
  [[ ! -e $protected && ! -L $protected ]] || { echo 'Existing journal installation refused; use its reviewed maintenance procedure' >&2; exit 1; }
done
id -u vera-journal >/dev/null 2>&1 || useradd --system --home-dir /var/lib/vera-journal --shell /usr/sbin/nologin vera-journal
install -d -o root -g vera-journal -m 0750 /etc/vera-journal /srv/vera-journal
install -d -o vera-journal -g vera-journal -m 0700 /var/lib/vera-journal
for required in server.json signing-private.pem api-token; do
  install -o root -g vera-journal -m 0640 "$config_source/$required" "/etc/vera-journal/$required"
done
install -o root -g vera-journal -m 0640 "$source_root/ops/recovery-journal/server.cjs" /srv/vera-journal/server.cjs
install -o root -g vera-journal -m 0640 "$source_root/ops/recovery-journal/protocol.cjs" /srv/vera-journal/protocol.cjs
runuser -u vera-journal -- env JOURNAL_SERVER_CONFIG=/etc/vera-journal/server.json /usr/bin/node /srv/vera-journal/server.cjs --initialize
install -o root -g root -m 0644 "$source_root/deploy/systemd/vera-journal.service" /etc/systemd/system/vera-journal.service
systemctl daemon-reload
systemctl enable --now vera-journal
echo 'Journal listening on loopback. Configure trusted HTTPS/firewall and verify API recovery before release.'
