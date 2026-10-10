import cron from 'node-cron';

cron.schedule('0 3 * * *', async () => {
  // nightly cleanup
});
