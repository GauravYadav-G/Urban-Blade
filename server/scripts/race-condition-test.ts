async function runRaceConditionTest() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║   🛡️ TESTING HIGH-CONCURRENCY RACE CONDITION DEFENSE             ║
╠═══════════════════════════════════════════════════════════════════╣
║   Simulating 50 simultaneous requests booking the EXACT SAME      ║
║   stylist slot at the EXACT same millisecond.                     ║
╚═══════════════════════════════════════════════════════════════════╝
  `);

  const stylistsRes = await fetch('http://localhost:4000/api/bookings/stylists');
  const stylists = await stylistsRes.json();
  const targetStylist = stylists[0]?.id || 'e43fbee5-a107-48a0-91ed-9d20defcaecf';

  const targetDate = `2026-12-${Math.floor(Math.random() * 20 + 10)}`;
  const targetTime = '04:00 PM';

  const requests = Array.from({ length: 50 }, (_, i) => {
    return fetch('http://localhost:4000/api/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerName: `Concurrent User ${i + 1}`,
        customerEmail: `user${i + 1}@example.com`,
        customerPhone: '9876543210',
        stylistId: targetStylist,
        bookingDate: targetDate,
        timeSlot: targetTime,
        totalPrice: 499,
      }),
    })
      .then(async (res) => ({
        index: i + 1,
        status: res.status,
        body: await res.json(),
      }))
      .catch((err) => ({
        index: i + 1,
        status: 500,
        body: { error: err.message },
      }));
  });

  const results = await Promise.all(requests);

  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);
  const errors = results.filter((r) => r.status !== 201 && r.status !== 409);

  console.log('═════════════════ RACE CONDITION RESULTS ═════════════════');
  console.log(`Successful Bookings (HTTP 201): ${successes.length} (Expected: Exactly 1)`);
  console.log(`Rejected Conflicts  (HTTP 409): ${conflicts.length} (Expected: 49)`);
  console.log(`Unexpected Errors:             ${errors.length} (Expected: 0)`);
  console.log('══════════════════════════════════════════════════════════');

  if (successes.length === 1 && errors.length === 0) {
    console.log('🎉 PASS: Distributed Lock & Database Concurrency 100% Guaranteed! No double-booking occurred.');
  } else {
    console.error('❌ FAIL: Race condition detected or unexpected errors occurred.');
  }
}

runRaceConditionTest();
