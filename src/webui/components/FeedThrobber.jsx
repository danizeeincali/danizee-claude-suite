import React from 'react';
import LambdaViThrobber from './LambdaViThrobber.jsx';
import './FeedThrobber.css';

/**
 * Throbber shown on feed posts or comments while Avi is processing.
 * Renders as a compact inline indicator that fits within feed item chrome.
 */
export default function FeedThrobber({
  action = 'processing',
  className = '',
}) {
  return (
    <div className={`feed-throbber ${className}`} role="status">
      <LambdaViThrobber size="small" inline />
      <span className="feed-throbber__action">{action}</span>
    </div>
  );
}
