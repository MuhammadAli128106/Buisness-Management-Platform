// const can = useCan(); can('crm.edit') — permission KEYS only, never role names (F1.3).
import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export function useCan() {
  const { user } = useAuth();
  return useCallback((key) => Boolean(user && (user.level === 'owner' || user.permissions?.includes(key))), [user]);
}
