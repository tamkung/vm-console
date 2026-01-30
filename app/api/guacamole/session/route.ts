import { NextRequest, NextResponse } from 'next/server';
import { sessionStore } from '../connect/route';

export async function GET(request: NextRequest) {
    const sessionId = request.nextUrl.searchParams.get('session');

    if (!sessionId) {
        return NextResponse.json({ error: 'Missing session ID' }, { status: 400 });
    }

    const session = sessionStore.get(sessionId);

    if (!session) {
        return NextResponse.json({ error: 'Session not found or expired' }, { status: 404 });
    }

    // Check if expired
    if (session.expiresAt < Date.now()) {
        sessionStore.delete(sessionId);
        return NextResponse.json({ error: 'Session expired' }, { status: 410 });
    }

    // Return the URL as JSON (client will use for iframe)
    return NextResponse.json({ url: session.url });
}
