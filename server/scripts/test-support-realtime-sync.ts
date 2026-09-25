import { buildApp } from '../src/app.js';
import { query, pool } from '../src/db/pool.js';
import type { FastifyInstance } from 'fastify';

async function runLiveChatSyncTest() {
  console.log('🧪 Starting Full Real-Time AI Chatbot & Master Admin Synchronization Test...\n');
  const app: FastifyInstance = await buildApp();

  try {
    // 1. Customer initiates chat through Ask Urban AI pop-up
    console.log('💬 1. Customer sends query from Storefront "Ask Urban AI" pop-up...');
    const userMsgRes = await app.inject({
      method: 'POST',
      url: '/api/support/live-chat/message',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        userName: 'Aakash Malhotra',
        userEmail: 'aakash.m@urbanblade.in',
        message: 'Which hair serum or scalp restorative oil is currently available in your catalog?',
      },
    });

    if (userMsgRes.statusCode !== 200) {
      throw new Error(`Failed to send user message: ${userMsgRes.statusCode} ${userMsgRes.body}`);
    }

    const userMsgData = JSON.parse(userMsgRes.body);
    console.log('   ✅ Pop-up Chat Response Received:');
    console.log(`      - Inquiry ID: ${userMsgData.inquiryId}`);
    console.log(`      - Messages Count: ${userMsgData.messages?.length}`);
    console.log(`      - AI Dynamic Reply: "${userMsgData.reply.slice(0, 100)}..."\n`);

    const customerInquiryId = userMsgData.inquiryId;
    if (!customerInquiryId) throw new Error('Missing inquiryId in response');

    // 2. Master Admin Query Discovery in Real Time
    console.log('🛡️ 2. Checking Master Admin Queries Console (GET /api/admin/support/inquiries)...');
    const adminInquiriesRes = await app.inject({
      method: 'GET',
      url: '/api/admin/support/inquiries',
    });

    if (adminInquiriesRes.statusCode !== 200) {
      throw new Error(`Failed to fetch admin inquiries: ${adminInquiriesRes.statusCode}`);
    }
    const adminInquiriesData = JSON.parse(adminInquiriesRes.body);
    const foundInquiry = adminInquiriesData.data?.find((inq: any) => inq.id === customerInquiryId);

    if (!foundInquiry) {
      throw new Error(`Master Admin panel did NOT find inquiry ${customerInquiryId}!`);
    }
    console.log(`   ✅ Query discovered live in Master Admin Desk!`);
    console.log(`      - Customer: ${foundInquiry.user_name} (${foundInquiry.user_email})`);
    console.log(`      - Status: ${foundInquiry.status}`);
    console.log(`      - Messages in DB: ${foundInquiry.messages?.length}\n`);

    // 3. Test Master Admin "Draft with AI" Dynamic AI Engine
    console.log('✨ 3. Master Admin uses "Draft with AI" (POST /api/admin/support/ai-chat)...');
    const aiDraftRes = await app.inject({
      method: 'POST',
      url: '/api/admin/support/ai-chat',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        inquiryId: customerInquiryId,
        customerName: foundInquiry.user_name,
        message: 'Can you recommend our best-selling hair and scalp serum with price and availability?',
      },
    });

    if (aiDraftRes.statusCode !== 200) {
      throw new Error(`AI Draft failed: ${aiDraftRes.statusCode} ${aiDraftRes.body}`);
    }
    const aiDraftData = JSON.parse(aiDraftRes.body);
    console.log('   ✅ Context-Aware AI Response Generated:');
    console.log(`      - Reply Snippet: "${aiDraftData.reply.slice(0, 110)}..."`);
    console.log(`      - Action: ${aiDraftData.action}`);
    console.log(`      - Agent: ${aiDraftData.agent}\n`);

    // 4. Master Admin sends reply to customer
    console.log('👨‍💻 4. Master Admin Specialist sends reply to customer thread...');
    const adminPostRes = await app.inject({
      method: 'POST',
      url: `/api/admin/support/inquiries/${customerInquiryId}/message`,
      headers: { 'Content-Type': 'application/json' },
      payload: {
        sender: 'admin',
        text: 'Greetings Aakash, Master Barber Raghav here. I have reserved the Rosemary & Keratin Scalp Restorative Serum for you with 10% VIP discount applied.',
      },
    });

    if (adminPostRes.statusCode !== 200) {
      throw new Error(`Failed to post admin reply: ${adminPostRes.statusCode} ${adminPostRes.body}`);
    }
    const adminPostData = JSON.parse(adminPostRes.body);
    console.log(`   ✅ Specialist response persisted in PostgreSQL! Messages count: ${adminPostData.inquiry?.messages?.length}\n`);

    // 5. Customer Pop-Up Polls and Receives Specialist Message
    console.log('🔄 5. Customer Pop-Up polls for live sync (GET /api/support/inquiries/:id)...');
    const customerPollRes = await app.inject({
      method: 'GET',
      url: `/api/support/inquiries/${customerInquiryId}`,
    });

    if (customerPollRes.statusCode !== 200) {
      throw new Error(`Customer poll failed: ${customerPollRes.statusCode}`);
    }
    const customerPollData = JSON.parse(customerPollRes.body);
    const messages = customerPollData.data?.messages || [];
    const latestAdminMsg = messages.find((m: any) => m.sender === 'admin' && m.text.includes('Raghav'));

    if (!latestAdminMsg) {
      throw new Error(`Customer pop-up did NOT receive the Master Admin reply!`);
    }
    console.log('   ✅ Real-time synchronization verified on customer storefront!');
    console.log(`      - Received Admin Message: "${latestAdminMsg.text}"`);
    console.log(`      - Sender: ${latestAdminMsg.sender}\n`);

    // 6. Master Admin Creates a New Ticket Directly
    console.log('🎫 6. Master Admin creates a new proactive ticket (POST /api/admin/support/inquiries)...');
    const createTicketRes = await app.inject({
      method: 'POST',
      url: '/api/admin/support/inquiries',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        userName: 'Siddharth Rao',
        userEmail: 'siddharth.r@urbanblade.in',
        subject: 'Custom Blade Sharpening & Maintenance Inquiry',
        priority: 'high',
        initialMessage: 'Hi Siddharth, our head barber noticed your subscription razor is due for 6-month ceramic realignment.',
      },
    });

    if (createTicketRes.statusCode !== 201) {
      throw new Error(`Failed to create ticket: ${createTicketRes.statusCode} ${createTicketRes.body}`);
    }
    const createTicketData = JSON.parse(createTicketRes.body);
    const newTicketId = createTicketData.inquiry?.id;
    console.log(`   ✅ New ticket created in PostgreSQL: ${newTicketId} (Status: ${createTicketData.inquiry?.status})\n`);

    // 7. Update status to 'ai_resolved'
    console.log('🏷️ 7. Master Admin updates ticket status (PUT /api/admin/support/inquiries/:id/status)...');
    const updateStatusRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/support/inquiries/${newTicketId}/status`,
      headers: { 'Content-Type': 'application/json' },
      payload: { status: 'ai_resolved' },
    });

    if (updateStatusRes.statusCode !== 200) {
      throw new Error(`Failed to update status: ${updateStatusRes.statusCode}`);
    }
    const updateStatusData = JSON.parse(updateStatusRes.body);
    console.log(`   ✅ Ticket status updated to: ${updateStatusData.inquiry?.status}\n`);

    // 8. Cleanup test records
    console.log('🧹 8. Cleaning up test records from PostgreSQL...');
    await query('DELETE FROM support_inquiries WHERE id IN ($1, $2)', [customerInquiryId, newTicketId]);
    console.log('   ✅ Test inquiries purged from PostgreSQL.\n');

    console.log('🎉 ALL REAL-TIME SYNCHRONIZATION AND AI CHATBOT AUDIT CHECKS PASSED WITH 100% SUCCESS!');
  } catch (err: any) {
    console.error('❌ Real-Time Sync Test Error:', err.message);
    process.exitCode = 1;
  } finally {
    await app.close();
    await pool.end().catch(() => {});
  }
}

runLiveChatSyncTest();
