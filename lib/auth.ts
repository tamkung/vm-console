import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_dev_secret_do_not_use_in_prod';

// Derive a 32-byte key from the secret for AES-256
const ENCRYPTION_KEY = crypto.scryptSync(JWT_SECRET, 'salt', 32);
const ALGORITHM = 'aes-256-cbc'; // or aes-256-gcm
const IV_LENGTH = 16;

export function encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text: string): string {
    const textParts = text.split(':');
    const ivH = textParts.shift();
    if (!ivH) throw new Error("Invalid encrypted text");
    const iv = Buffer.from(ivH, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

/**
 * Payload now includes sensitive data (creds), so we encrypt the whole payload object
 * into a single string field 'data' within the JWT.
 * 
 * Payload structure: { vmid, node, username, password, host }
 */
export function signShareToken(payload: object, expiresIn: string | number) {
    // Encrypt the sensitive JSON payload
    const jsonStr = JSON.stringify(payload);
    const encryptedData = encrypt(jsonStr);

    // Sign the JWT containing the encrypted blob
    return jwt.sign({ data: encryptedData }, JWT_SECRET, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });
}

export function verifyShareToken(token: string) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        if (!decoded || !decoded.data) return null;

        // Decrypt the data field
        const jsonStr = decrypt(decoded.data);
        const creds = JSON.parse(jsonStr);

        // Return credentials merged with expiration
        return { ...creds, exp: decoded.exp };
    } catch (error) {
        console.error("Token verification failed:", error);
        return null;
    }
}
