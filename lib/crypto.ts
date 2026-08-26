import crypto from "crypto"

function getSecretKey(explicitKey?: string): string {
  const key = explicitKey || process.env.RDP_ENCRYPTION_KEY || process.env.JWT_SECRET || "vm-console-default-secret-fallback-key";
  return key;
}

export interface DecryptedRDPPayload {
  url?: string
  port?: string
  user?: string
  password?: string
  vmName?: string
  consoleType?: string
  exp?: number
  iat?: number
}

export function encryptPayload(payload: object, secretKeyStr?: string): string {
  const effectiveKey = getSecretKey(secretKeyStr);
  const key = crypto.createHash("sha256").update(effectiveKey).digest()

  const iv = crypto.randomBytes(12)
  const now = Math.floor(Date.now() / 1000)
  const iat = (payload as DecryptedRDPPayload).iat || now
  const jsonStr = JSON.stringify({ ...payload, iat, exp: now + 3600 })

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(jsonStr, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`
}

export function decryptPayload(encryptedData: string, secretKeyStr?: string): DecryptedRDPPayload {
  const effectiveKey = getSecretKey(secretKeyStr);
  const parts = encryptedData.split(":")
  if (parts.length !== 3) {
    throw new Error("Invalid token format")
  }

  const iv = Buffer.from(parts[0], "hex")
  const authTag = Buffer.from(parts[1], "hex")
  const encrypted = Buffer.from(parts[2], "hex")

  const key = crypto.createHash("sha256").update(effectiveKey).digest()

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = decipher.update(encrypted) + decipher.final("utf8")
  return JSON.parse(decrypted) as DecryptedRDPPayload
}
