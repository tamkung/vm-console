# Proxmox Web Console

A modern, lightweight web interface for managing Proxmox Virtual Machines, built with **Next.js 15**, **TypeScript**, and **Tailwind CSS**.

![Dashboard Preview](./dashboard-preview.png) *(Add your screenshot here)*

## Features

### 🔐 Secure Authentication
- Support for **PAM** and **PVE** authentication realms.
- **Custom Host Login**: Connect to any Proxmox server URL directly from the login page (overrides default env config).
- **Secure Persistence**: Uses **HttpOnly Cookies** for session management.
- **Middleware Protection**: Unauthenticated access to dashboard/console is blocked server-side.

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

## 🛠️ Tech Stack
- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **VNC Client**: `novnc-next`
- **Proxy Server**: Custom Node.js server (`server.ts`) using `http-proxy-middleware` to handle WebSocket (WSS) tunneling to Proxmox.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ installed.
- Access to a Proxmox VE server.

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
    PROXMOX_URL=https://192.168.1.100:8006

    # Allow self-signed certificates (Development only)
    NODE_TLS_REJECT_UNAUTHORIZED=0
    ```

4.  **Run Development Server**:
    > **Note**: You must use the custom server script, not just `next dev`.
    ```bash
    npm run dev
    ```
    Matches script: `tsx server.ts`

5.  **Open Browser**:
    Navigate to `http://localhost:3000`

71: 
72: 5.  **Open Browser**:
73:     Navigate to `http://localhost:3000`
74: 
75: ---
76: 
77: ## 🐳 Docker Support
78: 
79: The project includes a `Dockerfile` and GitHub Actions workflow to automatically build and push images to Docker Hub.
80: 
81: ### Running with Docker
82: 
83: You can run the application using Docker, providing custom environment variables at runtime:
84: 
85: ```bash
86: docker run -d \
87:   -p 3000:3000 \
88:   -e PROXMOX_URL="https://192.168.1.100:8006" \
89:   -e NODE_TLS_REJECT_UNAUTHORIZED="0" \
90:   --name proxmox-console \
91:   yourusername/proxmox-web-console:latest
92: ```
93: 
94: *Note: `NODE_TLS_REJECT_UNAUTHORIZED="0"` is required if your Proxmox server uses a self-signed certificate.*
95: 
96: ---

## 📖 Usage Guide

### Logging In
1.  Enter your Proxmox **Username** and **Password**.
2.  Select the **Realm** (usually `Proxmox VE authentication server`).
3.  (Optional) Check **"Use Custom Host"** to connect to a specific server URL (e.g., `https://10.0.0.5:8006`).

### Using the Console
1.  Click on any **Running** VM in the dashboard to open the console.
2.  **Accept Certificates**: If using a self-signed cert, you may see a connection error first. Click the "Open Proxmox & Accept Cert" button, proceed through the browser warning, then close that tab and retry.
3.  **Controls**:
    - Use the top toolbar to send special keys.
    - Use the **Show/Hide Controls** button to slide the toolbar out of the way.

---

## ⚠️ Troubleshooting

-   **Connection Error (1006)**: Often caused by the browser blocking the WebSocket connection due to untrusted self-signed certificates.
    -   *Fix*: Open the Proxmox web interface directly in a new tab and ensure it loads without security warnings, then retry.
-   **Black Screen**: Ensure the VM display hardware is set to "Default" or "Standard VGA" in Proxmox.

---

## 📄 License
MIT
