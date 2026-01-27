import { NextRequest, NextResponse } from 'next/server';
import { verifyShareToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
    try {
        const { token } = await request.json();

        if (!token) {
            return NextResponse.json({ valid: false, error: 'Missing token' }, { status: 400 });
        }

        const payload = verifyShareToken(token);

        if (!payload) {
            // Token is invalid, expired, or revoked
            return NextResponse.json({ valid: false });
        }

        return NextResponse.json({ valid: true });

    } catch (error) {
        return NextResponse.json({ valid: false, error: 'Check failed' }, { status: 500 });
    }
}
