#!/bin/bash
# Deploy to Tencent Cloud server
# Usage: ./deploy.sh [server_ip]
set -e

SERVER="${1:-111.229.198.193}"
DIST_DIR="dist"
PROXY_SCRIPT="proxy/fund_proxy.py"

echo "=== Uploading frontend ==="
ssh "root@${SERVER}" "mkdir -p /var/www/fund-ledger"
scp -r ${DIST_DIR}/* "root@${SERVER}:/var/www/fund-ledger/"

echo "=== Uploading proxy ==="
scp ${PROXY_SCRIPT} "root@${SERVER}:/root/fund_proxy.py"

echo "=== Setting up proxy service ==="
ssh "root@${SERVER}" bash << 'ENDSSH'
# Install systemd service for proxy
cat > /etc/systemd/system/fund-proxy.service << 'EOF'
[Unit]
Description=Fund NAV Proxy
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /root/fund_proxy.py --port 8088
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable fund-proxy
systemctl restart fund-proxy

# Install Nginx if not present
if ! command -v nginx &>/dev/null; then
    apt-get update && apt-get install -y nginx
fi

# Nginx config
cat > /etc/nginx/sites-available/fund-ledger << 'NGINX'
server {
    listen 80;
    server_name hellomario.online 111.229.198.193;

    root /var/www/fund-ledger;
    index index.html;

    # API proxy → Python fund proxy
    location /api/fund {
        proxy_pass http://127.0.0.1:8088/;
        proxy_set_header Host $host;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/fund-ledger /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== Done ==="
echo "App: http://hellomario.online/"
echo "Proxy: systemctl status fund-proxy"
ENDSSH
