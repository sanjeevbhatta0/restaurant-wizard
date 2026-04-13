import React from 'react';
import { Modal, Button } from 'react-bootstrap';

/**
 * Reusable confirmation modal — replaces all window.confirm() usage.
 *
 * Usage:
 *   const [confirmState, setConfirmState] = useState(null);
 *   // Instead of: if (!window.confirm('Delete?')) return;
 *   setConfirmState({ message: 'Delete?', onConfirm: () => doDelete() });
 *   // Render: <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
 */
const ConfirmModal = ({ state, onClose, variant = 'danger' }) => {
  if (!state) return null;

  const handleConfirm = () => {
    state.onConfirm();
    onClose();
  };

  return (
    <Modal show centered onHide={onClose} size="sm">
      <Modal.Header closeButton>
        <Modal.Title>{state.title || 'Confirm'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{state.message}</Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={variant} onClick={handleConfirm}>
          {state.confirmText || 'Confirm'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ConfirmModal;
