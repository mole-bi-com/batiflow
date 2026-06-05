export function isOlderThan24Hours(dateText: string): boolean {
  if (!dateText) return false;
  
  const trimmed = dateText.trim().toLowerCase();
  if (trimmed === 'recent' || trimmed === 'now') {
    return false;
  }
  
  // 1. Try ISO / Date parsing
  const parsedTime = Date.parse(dateText);
  if (!isNaN(parsedTime)) {
    const diffMs = Date.now() - parsedTime;
    return diffMs > 24 * 60 * 60 * 1000;
  }
  
  // 2. Relative time string parsing
  
  // Check for week, month, year units
  const olderUnits = ['week', 'month', 'year', '주', '달', '개월', '년'];
  for (const unit of olderUnits) {
    if (trimmed.includes(unit)) {
      return true;
    }
  }

  // Check abbreviated units (LinkedIn/Instagram)
  // e.g. "1w", "3w", "2mo", "1yr"
  if (/\d+w/.test(trimmed) || /\d+mo/.test(trimmed) || /\d+yr/.test(trimmed)) {
    return true;
  }
  
  // Check for days:
  // LinkedIn/Instagram format: "2d", "3d"
  const dMatch = trimmed.match(/^(\d+)d$/);
  if (dMatch) {
    const days = parseInt(dMatch[1], 10);
    return days > 1; // 2d or more is older than 24 hours
  }
  
  // General English relative days: "2 days ago", "10 days ago"
  const dayMatch = trimmed.match(/(\d+)\s*days?\s*ago/);
  if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    return days > 1;
  }
  
  // General Korean relative days: "2일 전", "10일 전"
  const koDayMatch = trimmed.match(/(\d+)\s*일\s*전/);
  if (koDayMatch) {
    const days = parseInt(koDayMatch[1], 10);
    return days > 1;
  }

  return false; // Default to not older (safe fallback)
}
