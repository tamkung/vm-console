import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'shares.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface Share {
    id: string; // UUID
    vmid: number;
    node: string;
    createdAt: number;
    expiresAt: number;
    revoked: boolean;
    createdBy?: string;
}

function loadShares(): Share[] {
    if (!fs.existsSync(STORE_FILE)) {
        return [];
    }
    try {
        const data = fs.readFileSync(STORE_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error("Failed to load shares:", error);
        return [];
    }
}

function saveShares(shares: Share[]) {
    try {
        fs.writeFileSync(STORE_FILE, JSON.stringify(shares, null, 2));
    } catch (error) {
        console.error("Failed to save shares:", error);
    }
}

export const shareStore = {
    add(share: Share) {
        const shares = loadShares();
        shares.push(share);
        saveShares(shares);
    },

    get(id: string): Share | undefined {
        const shares = loadShares();
        return shares.find(s => s.id === id);
    },

    listAssets(vmid: number): Share[] {
        const shares = loadShares();
        const now = Date.now();
        // Return only active shares for this VM
        return shares.filter(s =>
            s.vmid === vmid &&
            !s.revoked &&
            s.expiresAt > now
        );
    },

    revoke(id: string) {
        const shares = loadShares();
        const index = shares.findIndex(s => s.id === id);
        if (index !== -1) {
            shares[index].revoked = true;
            saveShares(shares);
            return true;
        }
        return false;
    },

    isRevoked(id: string): boolean {
        const share = this.get(id);
        return share ? share.revoked : true; // Treat unknown shares as invalid/revoked if we enforce strict checking
    },

    // Cleanup expired shares
    cleanup() {
        const shares = loadShares();
        const now = Date.now();
        const validShares = shares.filter(s => s.expiresAt > now);
        if (validShares.length !== shares.length) {
            saveShares(validShares);
        }
    }
};
