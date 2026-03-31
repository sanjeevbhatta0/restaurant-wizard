/**
 * CSV export utility for analytics data
 */

const escapeCSV = (value) => {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const exportToCSV = (data, columns, filename) => {
  if (!data || data.length === 0) return;

  const header = columns.map(col => escapeCSV(col.label)).join(',');
  const rows = data.map(row =>
    columns.map(col => escapeCSV(col.accessor(row))).join(',')
  );

  const csvContent = [header, ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportOrdersCSV = (orders, dateRangeLabel) => {
  const columns = [
    { label: 'Order ID', accessor: (o) => o.id },
    { label: 'Date', accessor: (o) => {
      const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
      return d.toLocaleString();
    }},
    { label: 'Total', accessor: (o) => (o.total || 0).toFixed(2) },
    { label: 'Subtotal', accessor: (o) => (o.paymentDetails?.subtotal || o.total || 0).toFixed(2) },
    { label: 'Tax', accessor: (o) => (o.paymentDetails?.taxAmount || 0).toFixed(2) },
    { label: 'Tips', accessor: (o) => (o.paymentDetails?.tipAmount || 0).toFixed(2) },
    { label: 'Status', accessor: (o) => o.status || 'new' },
    { label: 'Source', accessor: (o) => o.source || 'pos' },
    { label: 'Order Type', accessor: (o) => o.orderType || 'dine_in' },
    { label: 'Payment Method', accessor: (o) => o.paymentMethod || 'N/A' },
    { label: 'Items', accessor: (o) => (o.items || []).map(i => `${i.name} x${i.quantity || 1}`).join('; ') },
    { label: 'Customer', accessor: (o) => o.customer?.name || o.customerId || 'Walk-in' }
  ];

  exportToCSV(orders, columns, `analytics_${dateRangeLabel.replace(/\s+/g, '_')}`);
};
