import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { shareStore } from '@/lib/store';

export async function POST(request: NextRequest) {
    try {
        const { shareId } = await request.json();

        if (!shareId) {
            return NextResponse.json({ error: 'Missing shareId' }, { status: 400 });
        }

        // Verify authentication
        const cookieStore = await cookies();
        const ticket = cookieStore.get('PVEAuthCookie')?.value;

        if (!ticket) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const success = shareStore.revoke(shareId);

        if (success) {
            return NextResponse.json({ success: true });
        } else {
            return NextResponse.json({ error: 'Share not found' }, { status: 404 });
        }
    } catch (error) {
        console.error('Share Cancel Error:', error);
        return NextResponse.json({ error: 'Failed to cancel share' }, { status: 500 });
    }
}
