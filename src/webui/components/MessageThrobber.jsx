import React from 'react';
import LambdaViThrobber from './LambdaViThrobber.jsx';
import './MessageThrobber.css';

/**
 * Throbber for the message-sending UI.
 * Shows the λVI animation alongside a status string
 * (e.g. "waiting for DM sensor", "sending…", "processing…").
 */
export default function MessageThrobber({
  status = 'working',
  className = '',
}) {
  return (
    <div className={`msg-throbber ${className}`}>
      <LambdaViThrobber size="small" inline label={status} />
    </div>
  );
}
