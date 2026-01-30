# Proxmox Web Console

A modern, lightweight web interface for managing Proxmox Virtual Machines, built with **Next.js 15**, **TypeScript**, and **Tailwind CSS**.

![Dashboard Preview](./dashboard-preview.png) *(Add your screenshot here)*

## Features

### 🔐 Secure Authentication
- Support for **PAM** and **PVE** authentication realms.
- **Custom Host Login**: Connect to any Proxmox server URL directly from the login page (overrides default env config).

### 🖥️ VM Management Dashboard
- View list of VMs with real-time status (Running, Stopped, Paused).
- Visualize resources: CPU, Memory text, and uptime.
- **Power Actions**: Start, Stop, Shutdown, Reboot (with SweetAlert2 confirmations).

### 🎮 Enhanced VNC Console
- **Web-based VNC**: Integrated using `novnc-next` and a custom WebSocket proxy.
- **Toolbar Controls**:
    - **Manual Toggle**: Hide/Show toolbar to maximize screen real estate.
    - **Key Injection**: Dedicated buttons for `Ctrl`, `Alt`, `Win`, `Tab`, `Esc`, and `Ctrl-Alt-Del`.
    - **Full Screen Mode**: Toggle browser full-screen for immersive experience.
- **Smooth UX**: Auto-scaling viewport and optimized layout.

### 🌐 Guacamole Remote Console (NEW)
- **Dynamic Connections**: Connect to any remote machine via RDP, VNC, or SSH.
- **No Pre-configuration**: Enter host/port/username/password on the fly.
- **Features**:
    - **Dynamic Resolution**: Automatically adjusts to window size (RDP).
    - **Clipboard Support**: Copy/paste between local and remote.
    - **Audio**: Remote audio playback and input.
    - **Drive Sharing**: Share local drives with remote machine.
- **Auto-hide Toolbar**: Full-screen console with toolbar appearing on hover.

## 🛠️ Tech Stack
- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **VNC Client**: `novnc-next`
- **Remote Console**: [Apache Guacamole](https://guacamole.apache.org/)
- **Proxy Server**: Custom Node.js server (`server.ts`) using `http-proxy-middleware` to handle WebSocket (WSS) tunneling to Proxmox.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ installed.
- Access to a Proxmox VE server.
- (Optional) Apache Guacamole server with `guacamole-auth-json` extension for remote console.

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yourusername/proxmox-web-console.git
    cd proxmox-web-console
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment**:
    Create a `.env.local` file in the root directory:
    ```env
    # Default Proxmox Host (Optional fallback)
    PROXMOX_URL=https://192.168.1.1:8006

    # Allow self-signed certificates (Development only)
    NODE_TLS_REJECT_UNAUTHORIZED=0

    # JWT Secret for VM Sharing (Required for share links)
    JWT_SECRET=your-secret-key-at-least-32-chars

    # Guacamole Configuration (Optional - for remote console)
    GUACAMOLE_URL=http://192.168.1.1:8080
    GUACAMOLE_SECRET_KEY=your-32-hex-character-secret-key
    ```

4.  **Run Development Server**:
    > **Note**: You must use the custom server script, not just `next dev`.
    ```bash
    npm run dev
    ```
    Matches script: `tsx server.ts`

5.  **Open Browser**:
    Navigate to `http://localhost:3000`

---

## 🌐 Guacamole Setup

To use the Guacamole Remote Console feature, you need to set up a Guacamole server with JSON authentication.

### 1. Install guacamole-auth-json Extension

```bash
# Download matching version (e.g., 1.6.0)
wget https://apache.org/dyn/closer.lua/guacamole/1.6.0/binary/guacamole-auth-json-1.6.0.tar.gz

# Extract and copy to extensions
tar xzf guacamole-auth-json-1.6.0.tar.gz
cp guacamole-auth-json-1.6.0/guacamole-auth-json-1.6.0.jar /etc/guacamole/extensions/
```

### 2. Configure guacamole.properties

Add the secret key to your Guacamole configuration:
```properties
json-secret-key: YOUR_32_HEX_CHARACTER_SECRET_KEY
```

### 3. Generate Secret Key

Generate a 128-bit hex key (32 characters):
```bash
openssl rand -hex 16
```

### 4. Docker Compose Example

```yaml
guacamole:
  image: guacamole/guacamole:1.6.0
  environment:
    GUACD_HOSTNAME: guacd
    POSTGRESQL_HOSTNAME: postgres
    POSTGRESQL_DATABASE: guacamole_db
    POSTGRESQL_USER: guacamole_user
    POSTGRESQL_PASSWORD: mypassword
    GUACAMOLE_HOME: /opt/guacamole/.guacamole
  volumes:
    - ./guac_home:/opt/guacamole/.guacamole
```

### 5. Update .env.local

```env
GUACAMOLE_URL=http://your-guacamole-server:8080
GUACAMOLE_SECRET_KEY=your-32-hex-character-secret-key
```

> **Important**: The `GUACAMOLE_SECRET_KEY` must match the `json-secret-key` in your Guacamole server configuration!

---

## 🐳 Docker Support

The project includes a `Dockerfile` and GitHub Actions workflow to automatically build and push images to Docker Hub.

### Running with Docker

You can run the application using Docker, providing custom environment variables at runtime:

```bash
docker run -d \
  -p 3000:3000 \
  -e PROXMOX_URL="https://192.168.1.100:8006" \
  -e NODE_TLS_REJECT_UNAUTHORIZED="0" \
  -e JWT_SECRET="your-secret-key-at-least-32-chars" \
  -e GUACAMOLE_URL="http://192.168.1.155:8080" \
  -e GUACAMOLE_SECRET_KEY="your-32-hex-character-secret-key" \
  --name proxmox-console \
  yourusername/proxmox-web-console:latest
```

*Note: `NODE_TLS_REJECT_UNAUTHORIZED="0"` is required if your Proxmox server uses a self-signed certificate.*

---

## 📖 Usage Guide

### Logging In
1.  Enter your Proxmox **Username** and **Password**.
2.  Select the **Realm** (usually `Proxmox VE authentication server`).
3.  (Optional) Check **"Use Custom Host"** to connect to a specific server URL (e.g., `https://10.0.0.5:8006`).

### Using the Proxmox Console
1.  Click on any **Running** VM in the dashboard to open the console.
2.  **Accept Certificates**: If using a self-signed cert, you may see a connection error first. Click the "Open Proxmox & Accept Cert" button, proceed through the browser warning, then close that tab and retry.
3.  **Controls**:
    - Use the top toolbar to send special keys.
    - Use the **Show/Hide Controls** button to slide the toolbar out of the way.

### Using the Guacamole Console
1.  Click the **Console** button (green) in the dashboard header.
2.  Select **Protocol** (RDP, VNC, or SSH).
3.  Enter **Host/IP**, **Port**, **Username**, and **Password**.
4.  Click **Connect**.
5.  The console will open in an embedded viewer with:
    - **Auto-hide toolbar**: Hover at the top edge for 1 second to reveal.
    - **Fullscreen button**: Click to go full screen.
    - **Back button**: Return to dashboard.

### Sharing VMs
1.  Click the **Share 🔗** button on any running VM card.
2.  Select a **Duration** (e.g., 1 Hour).
3.  Enter your **Proxmox Username** (e.g., `root@pam`) and **Password**.
    - *Note: These credentials are encrypted inside the share link so the guest can authenticate automatically. They are not stored on the server.*
4.  Copy the generated link and send it to your guest.


---

## ⚠️ Troubleshooting

-   **Connection Error (1006)**: Often caused by the browser blocking the WebSocket connection due to untrusted self-signed certificates.
    -   *Fix*: Open the Proxmox web interface directly in a new tab and ensure it loads without security warnings, then retry.
-   **Black Screen**: Ensure the VM display hardware is set to "Default" or "Standard VGA" in Proxmox.
-   **Guacamole "Invalid login"**: The `guacamole-auth-json` extension is not installed or the secret key doesn't match.
-   **Guacamole Redirect Loop**: Ensure your Guacamole server allows iframe embedding (check `X-Frame-Options` headers).

---

## 📄 License
MIT
