import autocannon from 'autocannon';

async function runBenchmark() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║   🔥 RUNNING HIGH-CONCURRENCY THROUGHPUT BENCHMARK                ║
╠═══════════════════════════════════════════════════════════════════╣
║   Target URL:     http://localhost:4000/api/products              ║
╠═══════════════════════════════════════════════════════════════════╣
║   Connections:    100 Concurrent Sockets                          ║
║   Duration:       10 Seconds Continuous Load                      ║
╚═══════════════════════════════════════════════════════════════════╝
  `);

  const instance = autocannon({
    url: 'http://localhost:4000/api/products',
    connections: 100,
    duration: 10,
    pipelining: 1,
    headers: {
      'Accept-Encoding': 'gzip, deflate',
    },
  });

  autocannon.track(instance, { renderProgressBar: true });

  instance.on('done', (result) => {
    console.log('\n═════════════════════ BENCHMARK RESULTS ═════════════════════');
    console.log(`Total Requests Handled:  ${result.requests.total}`);
    console.log(`Requests Per Second:     ${Math.round(result.requests.average)} req/sec`);
    console.log(`P50 (Median) Latency:    ${result.latency.p50} ms`);
    console.log(`P90 Latency:             ${result.latency.p90} ms`);
    console.log(`P99 Latency:             ${result.latency.p99} ms`);
    console.log(`P99.9 (Tail) Latency:    ${result.latency.p99_9} ms`);
    console.log(`Total 2xx Responses:     ${result['2xx']}`);
    console.log(`Total Non-2xx / Errors:  ${result.non2xx}`);
    console.log('═════════════════════════════════════════════════════════════\n');

    if (result.non2xx === 0 && result.latency.p95 < 40) {
      console.log('🎉 PASS: Amazon-grade high-throughput latency target achieved!');
    }
  });
}

runBenchmark();
