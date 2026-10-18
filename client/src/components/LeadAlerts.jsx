// Mounted once in Layout — owner: Ali (Q11). Polls my assigned leads every 3 s and toasts new ones.
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiGet } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export default function LeadAlerts() {
  const { user } = useAuth();
  const nav = useNavigate();
  const seen = useRef(null); // null until the first load, so existing leads don't all pop up at once
  const { data } = useSWR(user ? '/leads?scope=mine&status=assigned&limit=50' : null, apiGet, { refreshInterval: 3000 });

  useEffect(() => {
    if (!data?.data) return;
    const rows = data.data;
    if (seen.current === null) {
      seen.current = new Set(rows.map((l) => l.id));
      return;
    }
    for (const lead of rows) {
      if (seen.current.has(lead.id)) continue;
      seen.current.add(lead.id);
      const escalated = lead.escalation_count > 0;
      toast(escalated ? `Lead escalated to you: ${lead.contact_name}` : `New lead assigned: ${lead.contact_name}`, {
        description: 'Acknowledge it before the timer runs out.',
        duration: 10000,
        action: { label: 'Open', onClick: () => nav(`/leads/${lead.id}`) },
      });
    }
  }, [data, nav]);

  return null;
}
