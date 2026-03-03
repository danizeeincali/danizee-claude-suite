import React from 'react';
import LambdaViThrobber from './LambdaViThrobber.jsx';
import './DmHeaderThrobber.css';

/**
 * Throbber for the main DM UI header bar.
 * Displayed prominently at the top of the conversation
 * to indicate Avi is actively working on a response.
 */
export default function DmHeaderThrobber({
  label = 'Avi is working',
  visible = true,
  className = '',
}) {
  if (!visible) return null;

  return (
    <div className={`dm-header-throbber ${className}`} role="status">
      <LambdaViThrobber size="medium" label={label} />
    </div>
  );
}
