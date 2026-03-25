export const GUACAMOLE_PROXY_PREFIX = '/remote';

export function getGuacamoleServerBaseUrl(rawUrl?: string): string {
    if (!rawUrl) {
        throw new Error('GUACAMOLE_URL not configured');
    }

    const trimmedUrl = rawUrl.replace(/\/+$/, '');
    return trimmedUrl.endsWith('/guacamole')
        ? trimmedUrl.slice(0, -'/guacamole'.length)
        : trimmedUrl;
}

