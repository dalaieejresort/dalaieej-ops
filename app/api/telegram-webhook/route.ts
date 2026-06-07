import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const makeWebhookUrl = process.env.MAKE_WEBHOOK_URL;
    if (!makeWebhookUrl) {
      console.error('Configuration Error: MAKE_WEBHOOK_URL is missing.');
      return NextResponse.json({ error: 'Internal configuration error.' }, { status: 500 });
    }

    const payload = await request.json();
    console.log('Telegram Update Received:', payload.update_id);

    // Forward to Make.com
    const makeResponse = await fetch(makeWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!makeResponse.ok) {
      console.error(`Make.com rejected payload status: ${makeResponse.status}`);
      return NextResponse.json({ warning: 'Failed to forward to Make.' }, { status: 200 });
    }

    return NextResponse.json({ success: true, message: 'Payload sent to Make.' });
  } catch (error) {
    console.error('Fatal Webhook Exception:', error);
    return NextResponse.json({ error: 'Internal system exception.' }, { status: 200 });
  }
}