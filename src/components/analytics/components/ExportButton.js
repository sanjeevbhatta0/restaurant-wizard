import React from 'react';
import { Button } from 'react-bootstrap';
import { exportOrdersCSV } from '../utils/csvExport';

const ExportButton = ({ orders, rangeLabel }) => {
  const handleExport = () => {
    if (!orders || orders.length === 0) return;
    exportOrdersCSV(orders, rangeLabel);
  };

  return (
    <Button
      variant="outline-light"
      size="sm"
      onClick={handleExport}
      disabled={!orders || orders.length === 0}
      className="ca-export-btn"
    >
      <i className="bi bi-download me-1"></i>
      Export CSV
    </Button>
  );
};

export default ExportButton;
