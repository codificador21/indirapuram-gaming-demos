import type { CategoryKind } from './domain';

export interface CategoryDef {
  id: string;
  name: string;
  emoji: string;
  color: string;
  kind: CategoryKind;
}

/**
 * Built-in categories, created/updated by `npm run db:migrate`.
 * Colours are chosen to stay distinguishable on both the dark and light theme.
 */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: 'food', name: 'Food & dining', emoji: '🍔', color: '#f97316', kind: 'expense' },
  { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#84cc16', kind: 'expense' },
  { id: 'transport', name: 'Transport', emoji: '🚕', color: '#eab308', kind: 'expense' },
  { id: 'fuel', name: 'Fuel', emoji: '⛽', color: '#a16207', kind: 'expense' },
  { id: 'shopping', name: 'Shopping', emoji: '🛍️', color: '#ec4899', kind: 'expense' },
  { id: 'bills', name: 'Bills & utilities', emoji: '💡', color: '#06b6d4', kind: 'expense' },
  { id: 'entertainment', name: 'Entertainment', emoji: '🎬', color: '#8b5cf6', kind: 'expense' },
  { id: 'health', name: 'Health', emoji: '💊', color: '#ef4444', kind: 'expense' },
  { id: 'travel', name: 'Travel', emoji: '✈️', color: '#3b82f6', kind: 'expense' },
  { id: 'education', name: 'Education', emoji: '📚', color: '#14b8a6', kind: 'expense' },
  { id: 'personal_care', name: 'Personal care', emoji: '💇', color: '#f472b6', kind: 'expense' },
  { id: 'home', name: 'Home & rent', emoji: '🏠', color: '#0ea5e9', kind: 'expense' },
  { id: 'investments', name: 'Investments', emoji: '📈', color: '#10b981', kind: 'expense' },
  { id: 'emi_loans', name: 'EMIs & loans', emoji: '🏦', color: '#64748b', kind: 'expense' },
  { id: 'cash', name: 'Cash', emoji: '💵', color: '#22c55e', kind: 'expense' },
  { id: 'transfers', name: 'Sent to people', emoji: '👥', color: '#a855f7', kind: 'expense' },
  { id: 'gifts', name: 'Gifts & donations', emoji: '🎁', color: '#e11d48', kind: 'expense' },
  { id: 'fees', name: 'Fees & charges', emoji: '🧾', color: '#78716c', kind: 'expense' },
  { id: 'other', name: 'Other', emoji: '🏷️', color: '#94a3b8', kind: 'expense' },
  { id: 'salary', name: 'Salary', emoji: '💼', color: '#16a34a', kind: 'income' },
  { id: 'income', name: 'Other income', emoji: '💰', color: '#65a30d', kind: 'income' },
  { id: 'self_transfer', name: 'Self-transfer', emoji: '🔁', color: '#6b7280', kind: 'transfer' },
];

export const FALLBACK_CATEGORY = 'other';
