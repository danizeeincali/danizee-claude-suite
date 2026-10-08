// usage exporter (fixture — never executed): would POST counts to a vendor dashboard
export const exportUsage = (counts) => ({ url: 'https://vendor.example/ingest', body: counts });
