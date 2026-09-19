#!/bin/sh
# Regenerate screenshots/{light,dark} from a devel build, with fake data.
# Needs playwright-core in node_modules (npm i --no-save playwright-core)
# and a Chromium at the path in shoot.cjs; runs a throwaway local-session
# cockpit-ws on port 9999.
set -eu
cd "$(dirname "$0")/../.."
make devel
work=$(mktemp -d)
cp -r dist "$work/pkg"
{
    echo "window.MINSEC_INSPECT = $(sudo -n minsec --json inspect);"
    printf 'window.MINSEC_MAIN_TOML = %s;\n' "$(sudo -n cat /etc/minsec/minsec.toml | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')"
    cat screenshots/tools/mock.js
} > "$work/pkg/mock.js"
sed -i 's|<script src="index.js"></script>|<script src="mock.js"></script>\n    <script src="index.js"></script>|' "$work/pkg/index.html"
mkdir -p ~/.local/share/cockpit
ln -sfn "$work/pkg" ~/.local/share/cockpit/minsec
XDG_CONFIG_DIRS="$work" /usr/libexec/cockpit-ws --local-session=/usr/bin/cockpit-bridge -p 9999 -a 127.0.0.1 &
ws=$!
trap 'kill $ws; rm -f ~/.local/share/cockpit/minsec; rm -rf "$work"' EXIT
sleep 2
ln -s "$PWD/node_modules" "$work/node_modules"
(cd "$work" && node "$OLDPWD/screenshots/tools/shoot.cjs" light && node "$OLDPWD/screenshots/tools/shoot.cjs" dark)
rm -rf screenshots/light screenshots/dark
mv "$work/shots/light" "$work/shots/dark" screenshots/
