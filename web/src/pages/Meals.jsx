import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconUtensils, IconSearch, IconPlus } from '../components/Icons';
import { useCanWrite } from '../context/SubscriptionContext';
import SubscribePrompt from '../components/SubscribePrompt';

// ── Constants ─────────────────────────────────────────────────────

const MEAL_CATEGORIES = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack'];
// Meal plan shows only the daily meal slots — desserts stay in the Recipes library
const PLAN_CATEGORIES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const CATEGORY_COLOURS_MAP = {
  breakfast: { bg: 'bg-[#F5CBA7]', text: 'text-[#8B5E2B]', light: 'bg-[#F5CBA7]/20', border: 'border-[#F5CBA7]' },
  lunch:     { bg: 'bg-[#A9DFBF]', text: 'text-[#2E7D46]', light: 'bg-[#A9DFBF]/20', border: 'border-[#A9DFBF]' },
  dinner:    { bg: 'bg-[#AED6F1]', text: 'text-[#1F5F8B]', light: 'bg-[#AED6F1]/20', border: 'border-[#AED6F1]' },
  dessert:   { bg: 'bg-[#F5B7B1]', text: 'text-[#943126]', light: 'bg-[#F5B7B1]/20', border: 'border-[#F5B7B1]' },
  snack:     { bg: 'bg-[#D7BDE2]', text: 'text-[#6C3483]', light: 'bg-[#D7BDE2]/20', border: 'border-[#D7BDE2]' },
};
function getCatColours(cat) {
  return CATEGORY_COLOURS_MAP[(cat || 'dinner').toLowerCase()] || CATEGORY_COLOURS_MAP.dinner;
}
const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DIETARY_TAGS = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'Nut-free', 'Low-carb', 'High-protein'];
const UNITS = ['', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'oz', 'lb', 'pcs', 'bunch', 'clove', 'can', 'tin', 'pack'];

// ── Date helpers ──────────────────────────────────────────────────

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatWeekLabel(monday) {
  return monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getWeekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

// ══════════════════════════════════════════════════════════════════
// Main Meals Component
// ══════════════════════════════════════════════════════════════════

export default function Meals() {
  const [activeTab, setActiveTab] = useState('plan'); // 'plan' | 'recipes'
  const [error, setError] = useState('');
  const canWrite = useCanWrite();

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <h1
        className="text-[36px] font-normal leading-none text-bark flex items-center gap-2"
        style={{ fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif' }}
      >
        <div
          className="hidden md:flex"
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: '#f1eef8',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconUtensils className="h-5 w-5 text-plum" />
        </div>
        Meal Plan
      </h1>

      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {!canWrite && <SubscribePrompt message="Subscribe to plan meals, save recipes, and generate shopping lists" />}

      {/* Tab toggle */}
      <div className="flex gap-1 bg-oat rounded-xl p-1 border border-cream-border">
        <button
          onClick={() => setActiveTab('plan')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            activeTab === 'plan' ? 'bg-white text-bark ' : 'text-cocoa hover:text-bark'
          }`}
        >
          Meal Plan
        </button>
        <button
          onClick={() => setActiveTab('recipes')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            activeTab === 'recipes' ? 'bg-white text-bark ' : 'text-cocoa hover:text-bark'
          }`}
        >
          Recipe Box
        </button>
      </div>

      {activeTab === 'plan' ? (
        <MealPlanView error={error} setError={setError} onSwitchToRecipes={() => setActiveTab('recipes')} />
      ) : (
        <RecipeBoxView error={error} setError={setError} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Meal Plan View
// ══════════════════════════════════════════════════════════════════

function MealPlanView({ setError, onSwitchToRecipes }) {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [meals, setMeals] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [detailMeal, setDetailMeal] = useState(null);
  const [pickerCell, setPickerCell] = useState(null); // { date, category }
  const [editingMeal, setEditingMeal] = useState(null); // for editing existing meal via picker
  const [suggesting, setSuggesting] = useState(false);

  const detailRef = useRef(null);

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekParam = useMemo(() => toDateStr(weekStart), [weekStart]);

  // Load meals for the week
  const loadMeals = useCallback(async () => {
    try {
      const res = await api.get('/meals', { params: { week: weekParam } });
      const rawMeals = res.data?.meals ?? res.data;
      setMeals(Array.isArray(rawMeals) ? rawMeals : []);
    } catch {
      setError('Could not load meal plan.');
    } finally {
      setLoading(false);
    }
  }, [weekParam, setError]);

  useEffect(() => { setLoading(true); loadMeals(); }, [loadMeals]);

  // Close detail on outside click
  useEffect(() => {
    if (!detailMeal) return;
    function handleClick(e) {
      if (detailRef.current && !detailRef.current.contains(e.target)) setDetailMeal(null);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [detailMeal]);

  // Navigation
  function prevWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  }
  function nextWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  }
  function goToday() {
    setWeekStart(getMonday(new Date()));
  }

  // Get all meals for a specific cell
  function getMealsForCell(date, category) {
    const ds = toDateStr(date);
    const catLower = category.toLowerCase();
    return meals.filter(m => m.date === ds && m.category?.toLowerCase() === catLower);
  }

  // Delete meal
  async function deleteMeal(id) {
    if (!window.confirm('Remove this meal from the plan?')) return;
    try {
      await api.delete(`/meals/${id}`);
      setDetailMeal(null);
      await loadMeals();
    } catch {
      setError('Could not delete meal.');
    }
  }

  // Add ingredients to shopping list
  async function addToShoppingList(mealIds) {
    try {
      const res = await api.post('/meals/to-shopping-list', { meal_ids: mealIds });
      setError(''); // clear any previous
      setShoppingListSummary(res.data);
    } catch {
      setError('Could not add to shopping list.');
    }
  }

  // Add entire week to shopping list
  async function addWeekToShoppingList() {
    try {
      const res = await api.post('/meals/to-shopping-list', { week: weekParam });
      setShoppingListSummary(res.data);
    } catch {
      setError('Could not add to shopping list.');
    }
  }

  // Shopping list summary modal
  const [shoppingListSummary, setShoppingListSummary] = useState(null); // { added, skipped, summary }

  // Suggest meals (AI) — shows a modal with suggestions for empty dinner slots
  const [suggestResults, setSuggestResults] = useState(null); // { suggestions: [...], emptySlots: [...] }

  async function suggestMeals() {
    setSuggesting(true);
    try {
      // Find empty dinner slots for the week
      const emptySlots = [];
      for (const date of weekDates) {
        const ds = toDateStr(date);
        if (!meals.find(m => m.date === ds && m.category?.toLowerCase() === 'dinner')) {
          emptySlots.push({ date: ds, dayLabel: DAY_HEADERS[weekDates.indexOf(date)] + ' ' + date.getDate() });
        }
      }
      if (emptySlots.length === 0) {
        setError('All dinner slots are filled! Clear some slots first.');
        setSuggesting(false);
        return;
      }
      const res = await api.post('/meals/suggest', { category: 'dinner', count: emptySlots.length });
      const suggestions = res.data.suggestions ?? [];
      if (suggestions.length === 0) {
        setError('No suggestions were returned. Try again.');
      } else {
        // Pair suggestions with empty slots
        const paired = emptySlots.map((slot, i) => ({
          ...slot,
          suggestion: suggestions[i] || suggestions[suggestions.length - 1],
          accepted: true,
        }));
        setSuggestResults(paired);
      }
    } catch {
      setError('Could not generate suggestions.');
    } finally {
      setSuggesting(false);
    }
  }

  async function acceptSuggestions() {
    if (!suggestResults) return;
    const toAdd = suggestResults.filter(s => s.accepted);
    if (toAdd.length === 0) { setSuggestResults(null); return; }
    try {
      for (const slot of toAdd) {
        await api.post('/meals/accept-suggestion', {
          date: slot.date,
          category: 'dinner',
          suggestion: slot.suggestion,
        });
      }
      setSuggestResults(null);
      await loadMeals();
    } catch {
      setError('Could not save suggested meals.');
    }
  }

  function toggleSuggestion(index) {
    setSuggestResults(prev => prev.map((s, i) => i === index ? { ...s, accepted: !s.accepted } : s));
  }

  // Handle meal selected from picker
  async function handleMealPicked(data) {
    // null signals that the meal was already saved (e.g. via accept-suggestion), just reload
    if (data === null) {
      setPickerCell(null);
      setEditingMeal(null);
      await loadMeals();
      return;
    }
    try {
      const categoryLower = pickerCell.category.toLowerCase();
      if (editingMeal) {
        await api.patch(`/meals/${editingMeal.id}`, {
          ...data,
          date: pickerCell.date,
          category: categoryLower,
        });
      } else {
        await api.post('/meals', {
          ...data,
          date: pickerCell.date,
          category: categoryLower,
        });
      }
      setPickerCell(null);
      setEditingMeal(null);
      await loadMeals();
    } catch {
      setError('Could not save meal.');
    }
  }

  const isCurrentWeek = toDateStr(getMonday(new Date())) === weekParam;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <>
      {/* Week navigation — hidden on print (the print-only heading below
          replaces it with a clean "Weekly Meal Plan · Week of X" title). */}
      <div className="flex items-center justify-between bg-linen rounded-2xl  border border-cream-border px-4 py-3 no-print">
        <button onClick={prevWeek} className="p-1.5 rounded-lg hover:bg-oat text-cocoa transition-colors">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-bark">
            Week of {formatWeekLabel(weekStart)}
          </span>
          {!isCurrentWeek && (
            <button onClick={goToday} className="text-xs font-medium text-primary hover:underline">
              Today
            </button>
          )}
        </div>
        <button onClick={nextWeek} className="p-1.5 rounded-lg hover:bg-oat text-cocoa transition-colors">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
        </button>
      </div>

      {/* Print styles — scoped to @media print so they don't touch the
          normal UI. visibility-based hiding keeps layout stable and
          avoids cascading `display:none` up through Layout/Main parents.
          @page sets landscape as the browser's default orientation for
          this print — user can still change it in the dialog if they
          really want portrait. */}
      <style>{`
        @media print {
          @page { size: landscape; margin: 10mm; }
          body * { visibility: hidden; }
          .meal-plan-printable,
          .meal-plan-printable * { visibility: visible; }
          .meal-plan-printable {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
          }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          /* Stronger borders and white background on the grid so it
             renders clearly on paper (removes the cream background fill). */
          .meal-plan-printable table,
          .meal-plan-printable th,
          .meal-plan-printable td { border-color: #666 !important; background: #fff !important; }
          .meal-plan-printable .bg-linen { background: #fff !important; }
        }
        .print-only { display: none; }
      `}</style>

      {loading ? <Spinner /> : (
        // space-y-5 restores the vertical gap between the grid and the
        // action buttons. The outer container's space-y-5 applies only
        // to its DIRECT children; wrapping the grid + buttons in this
        // div moved them a level deeper, so the spacing has to be
        // reapplied here.
        <div className="meal-plan-printable space-y-5">
          {/* Print-only heading — replaces the on-screen nav at print time
              so the printed sheet shows which week it covers. Logo at the
              top for a branded print-out. */}
          <div className="print-only text-center" style={{ marginBottom: '24px' }}>
            <img
              src="/housemait-logo2.png"
              alt="Housemait"
              style={{ height: '36px', display: 'inline-block', marginBottom: '12px' }}
            />
            <h1 style={{ fontFamily: 'Lora, Georgia, serif', fontWeight: 600, fontSize: '22px', margin: '0 0 4px' }}>
              Weekly Meal Plan
            </h1>
            <p style={{ fontSize: '14px', color: '#555', margin: 0 }}>
              Week of {formatWeekLabel(weekStart)}
            </p>
          </div>

          {/* Weekly grid */}
          <div className="bg-linen rounded-2xl  border border-cream-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] border-collapse">
                <thead>
                  <tr>
                    <th className="w-24 py-3 px-3 text-left text-xs font-semibold text-cocoa uppercase tracking-wide border-b border-cream-border" />
                    {weekDates.map((date, i) => {
                      const isToday = toDateStr(date) === toDateStr(today);
                      return (
                        <th key={i} className={`py-3 px-2 text-center border-b border-l border-cream-border ${isToday ? 'bg-oat' : ''}`}>
                          <div className="text-xs text-cocoa font-medium">{DAY_HEADERS[i]}</div>
                          <div className={`text-sm font-semibold mt-0.5 ${isToday ? 'bg-primary text-white w-7 h-7 rounded-full inline-flex items-center justify-center' : 'text-bark'}`}>
                            {date.getDate()}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {PLAN_CATEGORIES.map((category) => {
                    const colors = getCatColours(category);
                    return (
                      <tr key={category}>
                        <td className="py-2 px-3 border-b border-cream-border">
                          <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-lg ${colors.bg} ${colors.text}`}>
                            {category}
                          </span>
                        </td>
                        {weekDates.map((date, i) => {
                          const cellMeals = getMealsForCell(date, category);
                          const isToday = toDateStr(date) === toDateStr(today);
                          return (
                            <td
                              key={i}
                              className={`py-1.5 px-1.5 border-b border-l border-cream-border align-top min-w-[90px] ${isToday ? 'bg-oat/30' : ''}`}
                            >
                              <div className="flex flex-col gap-1">
                                {cellMeals.map(meal => (
                                  <button
                                    key={meal.id}
                                    onClick={() => setDetailMeal(meal)}
                                    className={`w-full text-left p-1.5 rounded-lg text-xs font-medium transition-all hover: ${colors.light} ${colors.text} ${colors.border} border`}
                                  >
                                    <span className="line-clamp-2">{meal.meal_name}</span>
                                  </button>
                                ))}
                                <button
                                  onClick={() => { setPickerCell({ date: toDateStr(date), category }); setEditingMeal(null); }}
                                  className={`no-print w-full rounded-lg border border-dashed border-cream-border text-cocoa/40 hover:border-primary hover:text-primary hover:bg-primary/5 transition-all flex items-center justify-center ${cellMeals.length > 0 ? 'h-6' : 'h-10'}`}
                                >
                                  <span className={`leading-none ${cellMeals.length > 0 ? 'text-sm' : 'text-lg'}`}>+</span>
                                </button>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action buttons — left group stays on the left, Print sits
              to the right via justify-between. Wraps cleanly on narrow
              screens (Print drops onto its own line). All hidden from
              the printed sheet via no-print. */}
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="flex flex-wrap gap-3">
              <button
                onClick={onSwitchToRecipes}
                className="flex items-center gap-2 px-4 py-2.5 bg-linen border border-cream-border rounded-xl text-sm font-medium text-bark hover: transition-all"
              >
                <span>📚</span> Recipe Box
              </button>
              <button
                onClick={addWeekToShoppingList}
                className="flex items-center gap-2 px-4 py-2.5 bg-linen border border-cream-border rounded-xl text-sm font-medium text-bark hover: transition-all"
              >
                <span>🛒</span> Add to Shopping List
              </button>
            </div>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2.5 bg-linen border border-cream-border rounded-xl text-sm font-medium text-bark hover: transition-all"
              title="Opens the browser's print dialog in landscape orientation"
            >
              <span>🖨️</span> Print meal plan
            </button>
          </div>
        </div>
      )}

      {/* Meal detail popup */}
      {detailMeal && (
        <MealDetailPopup
          meal={detailMeal}
          ref={detailRef}
          onClose={() => setDetailMeal(null)}
          onEdit={() => {
            setPickerCell({ date: detailMeal.date, category: detailMeal.category });
            setEditingMeal(detailMeal);
            setDetailMeal(null);
          }}
          onDelete={() => deleteMeal(detailMeal.id)}
          onAddToShoppingList={() => addToShoppingList([detailMeal.id])}
        />
      )}

      {/* Meal picker modal */}
      {pickerCell && (
        <MealPickerModal
          cell={pickerCell}
          existingMeal={editingMeal}
          onSelect={handleMealPicked}
          onClose={() => { setPickerCell(null); setEditingMeal(null); }}
          setError={setError}
        />
      )}

      {/* Shopping List Summary Modal */}
      {shoppingListSummary && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-linen w-full sm:w-[480px] sm:rounded-2xl rounded-t-2xl  border border-cream-border max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-cream-border flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-bold text-bark">Shopping List Updated</h3>
                <p className="text-xs text-cocoa mt-0.5">{shoppingListSummary.summary}</p>
              </div>
              <button onClick={() => setShoppingListSummary(null)} className="text-cocoa hover:text-bark p-1 transition-colors">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {shoppingListSummary.added?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-bark mb-2 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-success/20 text-success flex items-center justify-center text-xs">+</span>
                    Items added ({shoppingListSummary.added.length})
                  </h4>
                  <ul className="space-y-1.5">
                    {shoppingListSummary.added.map((item, i) => (
                      <li key={i} className="text-sm text-bark bg-white rounded-lg border border-cream-border px-3 py-2">
                        {item.quantity && <span className="font-medium">{item.quantity}</span>}
                        {item.unit && <span> {item.unit}</span>}
                        {(item.quantity || item.unit) && <span> </span>}
                        {item.item || item.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {shoppingListSummary.skipped?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-cocoa mb-2 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-oat text-cocoa flex items-center justify-center text-xs">-</span>
                    Skipped ({shoppingListSummary.skipped.length})
                  </h4>
                  <ul className="space-y-1.5">
                    {shoppingListSummary.skipped.map((item, i) => (
                      <li key={i} className="text-sm text-cocoa bg-oat/50 rounded-lg px-3 py-2">
                        {item.item || item.name}
                        {item.reason && <span className="text-xs text-cocoa/60 ml-1">({item.reason})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(!shoppingListSummary.added || shoppingListSummary.added.length === 0) && (!shoppingListSummary.skipped || shoppingListSummary.skipped.length === 0) && (
                <p className="text-center text-cocoa text-sm py-4">{shoppingListSummary.summary || 'No ingredients to add.'}</p>
              )}
            </div>
            <div className="px-5 py-4 border-t border-cream-border shrink-0">
              <button
                onClick={() => setShoppingListSummary(null)}
                className="w-full py-3 bg-primary hover:bg-primary-pressed text-white rounded-xl text-sm font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Suggestions modal */}
      {suggestResults && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-linen w-full sm:w-[480px] sm:rounded-2xl rounded-t-2xl  border border-cream-border max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-cream-border flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-bold text-bark">Dinner Suggestions</h3>
                <p className="text-xs text-cocoa mt-0.5">AI-picked meals for your empty dinner slots</p>
              </div>
              <button onClick={() => setSuggestResults(null)} className="text-cocoa hover:text-bark p-1 transition-colors">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {suggestResults.map((slot, i) => (
                <div
                  key={i}
                  className={`bg-white rounded-xl border p-3.5 transition-all cursor-pointer ${
                    slot.accepted ? 'border-primary/40 ' : 'border-cream-border opacity-50'
                  }`}
                  onClick={() => toggleSuggestion(i)}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                      slot.accepted ? 'bg-primary border-primary text-white' : 'border-cream-border'
                    }`}>
                      {slot.accepted && <span className="text-xs">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-cocoa bg-oat px-2 py-0.5 rounded-lg">{slot.dayLabel}</span>
                      </div>
                      <p className="text-sm font-semibold text-bark mt-1">{slot.suggestion.meal_name || slot.suggestion.name}</p>
                      {slot.suggestion.description && (
                        <p className="text-xs text-cocoa mt-0.5">{slot.suggestion.description}</p>
                      )}
                      {slot.suggestion.prep_time_mins && (
                        <p className="text-xs text-cocoa/60 mt-0.5">⏱ {slot.suggestion.prep_time_mins} mins{slot.suggestion.cook_time_mins ? ` · ${slot.suggestion.cook_time_mins} mins cook` : ''}</p>
                      )}
                      {slot.suggestion.ingredients?.length > 0 && (
                        <p className="text-xs text-cocoa/60 mt-0.5 line-clamp-1">
                          Ingredients: {slot.suggestion.ingredients.slice(0, 4).map(ing => ing.name).join(', ')}{slot.suggestion.ingredients.length > 4 ? ` +${slot.suggestion.ingredients.length - 4} more` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-cream-border shrink-0 flex gap-3">
              <button
                onClick={() => setSuggestResults(null)}
                className="flex-1 py-3 bg-oat hover:bg-cream-border text-bark rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={acceptSuggestions}
                disabled={!suggestResults.some(s => s.accepted)}
                className="flex-1 py-3 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Add {suggestResults.filter(s => s.accepted).length} to plan
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// Meal Detail Popup
// ══════════════════════════════════════════════════════════════════

import { forwardRef } from 'react';

const MealDetailPopup = forwardRef(function MealDetailPopup({ meal, onClose, onEdit, onDelete, onAddToShoppingList }, ref) {
  const colors = getCatColours(meal.category);
  const recipe = meal.recipe;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div ref={ref} className="bg-linen w-full sm:w-[480px] sm:rounded-2xl rounded-t-2xl  border border-cream-border max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className={`px-5 py-4 ${colors.bg} sm:rounded-t-2xl`}>
          <div className="flex items-start justify-between">
            <div>
              <span className={`text-xs font-semibold ${colors.text} uppercase tracking-wide`}>{meal.category}</span>
              <h3 className="text-lg font-bold text-bark mt-1">{meal.meal_name}</h3>
            </div>
            <button onClick={onClose} className="text-bark/60 hover:text-bark p-1 transition-colors">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          {recipe && (
            <div className="flex items-center gap-3 mt-2 text-xs text-bark/70">
              {recipe.prep_time_mins && <span>Prep: {recipe.prep_time_mins}min</span>}
              {recipe.cook_time_mins && <span>Cook: {recipe.cook_time_mins}min</span>}
              {recipe.servings && <span>Serves: {recipe.servings}</span>}
            </div>
          )}
          {(recipe?.dietary_tags || recipe?.tags)?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(recipe.dietary_tags || recipe.tags).map(tag => (
                <span key={tag} className="text-[10px] font-medium bg-white/60 text-bark/70 px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* Ingredients */}
          {recipe?.ingredients?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-bark mb-2">Ingredients</h4>
              <ul className="space-y-1">
                {recipe.ingredients.map((ing, i) => (
                  <li key={i} className="text-sm text-cocoa flex items-start gap-2">
                    <span className="text-primary mt-1.5 shrink-0">
                      <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="3" /></svg>
                    </span>
                    <span>
                      {ing.quantity && <span className="font-medium">{ing.quantity}</span>}
                      {ing.unit && <span> {ing.unit}</span>}
                      {(ing.quantity || ing.unit) && <span> </span>}
                      {ing.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Method */}
          {recipe?.method && (
            <div>
              <h4 className="text-sm font-semibold text-bark mb-2">Method</h4>
              <div className="text-sm text-cocoa whitespace-pre-line leading-relaxed">{recipe.method}</div>
            </div>
          )}

          {/* Notes */}
          {meal.notes && (
            <div>
              <h4 className="text-sm font-semibold text-bark mb-2">Notes</h4>
              <p className="text-sm text-cocoa">{meal.notes}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-cream-border">
            {recipe?.ingredients?.length > 0 && (
              <button
                onClick={onAddToShoppingList}
                className="flex-1 min-w-[140px] py-2.5 bg-primary hover:bg-primary-pressed text-white rounded-xl text-sm font-medium transition-colors"
              >
                Add ingredients to list
              </button>
            )}
            <button
              onClick={onEdit}
              className="px-4 py-2.5 bg-oat hover:bg-cream-border text-bark rounded-xl text-sm font-medium transition-colors"
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              className="px-4 py-2.5 text-error hover:bg-error/10 rounded-xl text-sm font-medium transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════
// Meal Picker Modal
// ══════════════════════════════════════════════════════════════════

function MealPickerModal({ cell, existingMeal, onSelect, onClose, setError }) {
  const [tab, setTab] = useState('recipes'); // 'recipes' | 'quick' | 'ai'
  const [search, setSearch] = useState('');
  const [recipes, setRecipes] = useState([]);
  const [loadingRecipes, setLoadingRecipes] = useState(true);
  const [quickName, setQuickName] = useState(existingMeal?.meal_name || '');
  const [quickNotes, setQuickNotes] = useState(existingMeal?.notes || '');
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const modalRef = useRef(null);

  const colors = getCatColours(cell.category);

  // Load all recipes (not filtered by slot category — any recipe can go in any slot)
  useEffect(() => {
    async function load() {
      setLoadingRecipes(true);
      try {
        const params = {};
        if (search) params.search = search;
        const res = await api.get('/recipes', { params });
        { const r = res.data?.recipes ?? res.data; setRecipes(Array.isArray(r) ? r : []); }
      } catch {
        setError('Could not load recipes.');
      } finally {
        setLoadingRecipes(false);
      }
    }
    if (tab === 'recipes') load();
  }, [tab, search, setError]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (modalRef.current && !modalRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  function selectRecipe(recipe) {
    onSelect({ recipe_id: recipe.id, meal_name: recipe.name });
  }

  function submitQuickAdd() {
    if (!quickName.trim()) return;
    onSelect({ meal_name: quickName.trim(), notes: quickNotes.trim() || undefined });
  }

  async function fetchAiSuggestions() {
    setAiLoading(true);
    try {
      const res = await api.post('/meals/suggest', { category: cell.category, count: 5 });
      setAiSuggestions(res.data.suggestions ?? []);
    } catch {
      setError('Could not get AI suggestions.');
    } finally {
      setAiLoading(false);
    }
  }

  async function acceptAiSuggestion(suggestion) {
    try {
      await api.post('/meals/accept-suggestion', {
        date: cell.date,
        category: cell.category.toLowerCase(),
        suggestion,
      });
      // Signal parent to reload (null = already saved, just refresh)
      onSelect(null);
    } catch {
      setError('Could not save suggested meal.');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div ref={modalRef} className="bg-linen w-full sm:w-[500px] sm:rounded-2xl rounded-t-2xl  border border-cream-border max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-cream-border flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-lg font-bold text-bark">{existingMeal ? 'Edit Meal' : 'Add Meal'}</h3>
            <span className={`text-xs font-medium ${colors.text}`}>{cell.category} &middot; {cell.date}</span>
          </div>
          <button onClick={onClose} className="text-cocoa hover:text-bark p-1 transition-colors">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-5 pt-3 pb-2 shrink-0">
          {[
            { key: 'recipes', label: 'Recipe Box' },
            { key: 'quick', label: 'Quick Add' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === t.key ? 'bg-primary text-white' : 'bg-oat text-cocoa hover:text-bark'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {tab === 'recipes' && (
            <div className="space-y-3 pt-2">
              <div className="relative">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cocoa" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search recipes..."
                  className="w-full pl-9 pr-3 py-2.5 border border-cream-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              {loadingRecipes ? <Spinner /> : (
                recipes.length === 0 ? (
                  <p className="text-center text-cocoa text-sm py-6">No recipes found for {cell.category}.</p>
                ) : (
                  <ul className="space-y-2">
                    {[...recipes].sort((a, b) => {
                      const aFav = a.is_favourite || a.favourite ? 1 : 0;
                      const bFav = b.is_favourite || b.favourite ? 1 : 0;
                      return bFav - aFav;
                    }).map(recipe => (
                      <li key={recipe.id}>
                        <button
                          onClick={() => selectRecipe(recipe)}
                          className="w-full text-left bg-white rounded-xl border border-cream-border p-3 hover: hover:border-primary/30 transition-all"
                        >
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-bark">{recipe.name}</p>
                            {(recipe.is_favourite || recipe.favourite) && <span className="text-xs" title="Favourite">⭐</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-cocoa">
                            {recipe.prep_time_mins && <span>Prep: {recipe.prep_time_mins}m</span>}
                            {recipe.cook_time_mins && <span>Cook: {recipe.cook_time_mins}m</span>}
                          </div>
                          {(recipe.dietary_tags || recipe.tags)?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {(recipe.dietary_tags || recipe.tags).map(tag => (
                                <span key={tag} className="text-[10px] font-medium bg-oat text-cocoa px-2 py-0.5 rounded-full">{tag}</span>
                              ))}
                            </div>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          )}

          {tab === 'quick' && (
            <div className="space-y-4 pt-2">
              <div>
                <label className="block text-xs font-medium text-bark mb-1.5">Meal name</label>
                <input
                  type="text"
                  value={quickName}
                  onChange={e => setQuickName(e.target.value)}
                  placeholder="e.g. Leftovers, Eating out..."
                  className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-bark mb-1.5">Notes (optional)</label>
                <textarea
                  value={quickNotes}
                  onChange={e => setQuickNotes(e.target.value)}
                  placeholder="Any notes..."
                  rows={2}
                  className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                />
              </div>
              <button
                onClick={submitQuickAdd}
                disabled={!quickName.trim()}
                className="w-full py-3 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                {existingMeal ? 'Update Meal' : 'Add Meal'}
              </button>
            </div>
          )}

          {tab === 'ai' && (
            <div className="space-y-3 pt-2">
              {aiSuggestions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-cocoa mb-4">Get AI-powered meal suggestions for {cell.category}.</p>
                  <button
                    onClick={fetchAiSuggestions}
                    disabled={aiLoading}
                    className="px-6 py-3 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    {aiLoading ? 'Generating...' : 'Suggest Meals'}
                  </button>
                </div>
              ) : (
                <>
                  <ul className="space-y-2">
                    {aiSuggestions.map((s, i) => (
                      <li key={i} className="bg-white rounded-xl border border-cream-border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-bark">{s.meal_name || s.name}</p>
                            {(s.description || s.reason) && <p className="text-xs text-cocoa mt-1">{s.description || s.reason}</p>}
                            {s.prep_time_mins && <p className="text-xs text-cocoa/60 mt-0.5">⏱ {s.prep_time_mins} mins prep{s.cook_time_mins ? ` · ${s.cook_time_mins} mins cook` : ''}</p>}
                            {s.ingredients?.length > 0 && (
                              <p className="text-xs text-cocoa/60 mt-1 line-clamp-2">
                                Ingredients: {s.ingredients.slice(0, 5).map(ing => ing.name).join(', ')}{s.ingredients.length > 5 ? ` +${s.ingredients.length - 5} more` : ''}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => acceptAiSuggestion(s)}
                            className="shrink-0 px-3 py-1.5 bg-primary hover:bg-primary-pressed text-white rounded-lg text-xs font-medium transition-colors"
                          >
                            Add
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={fetchAiSuggestions}
                    disabled={aiLoading}
                    className="w-full py-2.5 text-sm font-medium text-primary hover:bg-primary/5 rounded-xl transition-colors"
                  >
                    {aiLoading ? 'Generating...' : 'Refresh suggestions'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Recipe Box View
// ══════════════════════════════════════════════════════════════════

function RecipeBoxView({ setError }) {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [favOnly, setFavOnly] = useState(false);

  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [recipeForm, setRecipeForm] = useState(null); // recipe object for manual form
  const [detailRecipe, setDetailRecipe] = useState(null);
  const [importUrl, setImportUrl] = useState('');
  const [importingUrl, setImportingUrl] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [generatingAi, setGeneratingAi] = useState(false);

  const loadRecipes = useCallback(async () => {
    try {
      const params = {};
      if (search) params.search = search;
      if (catFilter) params.category = catFilter.toLowerCase();
      if (tagFilter) params.tag = tagFilter;
      if (favOnly) params.favourites = 'true';
      const res = await api.get('/recipes', { params });
      { const r = res.data?.recipes ?? res.data; setRecipes(Array.isArray(r) ? r : []); }
    } catch {
      setError('Could not load recipes.');
    } finally {
      setLoading(false);
    }
  }, [search, catFilter, tagFilter, favOnly, setError]);

  useEffect(() => { setLoading(true); loadRecipes(); }, [loadRecipes]);

  // Toggle favourite
  async function toggleFavourite(recipe, e) {
    e.stopPropagation();
    try {
      await api.patch(`/recipes/${recipe.id}`, { is_favourite: !(recipe.is_favourite || recipe.favourite) });
      await loadRecipes();
    } catch {
      setError('Could not update favourite.');
    }
  }

  // Delete recipe
  async function deleteRecipe(id) {
    if (!window.confirm('Delete this recipe? This cannot be undone.')) return;
    try {
      await api.delete(`/recipes/${id}`);
      setDetailRecipe(null);
      await loadRecipes();
    } catch {
      setError('Could not delete recipe.');
    }
  }

  // Import from URL
  async function handleImportUrl() {
    if (!importUrl.trim()) return;
    setImportingUrl(true);
    try {
      const res = await api.post('/recipes/import-url', { url: importUrl.trim() });
      setImportUrl('');
      setAddModalOpen(false);
      if (res.data.recipe) {
        setDetailRecipe(res.data.recipe);
      }
      await loadRecipes();
    } catch {
      setError('Could not import recipe from URL.');
    } finally {
      setImportingUrl(false);
    }
  }

  // Generate with AI
  async function handleAiGenerate() {
    if (!aiDescription.trim()) return;
    setGeneratingAi(true);
    try {
      const res = await api.post('/recipes/generate', { description: aiDescription.trim() });
      setAiDescription('');
      setAddModalOpen(false);
      if (res.data.recipe) {
        setRecipeForm(res.data.recipe); // open form to review
      }
      await loadRecipes();
    } catch {
      setError('Could not generate recipe.');
    } finally {
      setGeneratingAi(false);
    }
  }

  // Import from photo
  async function handlePhotoImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await api.post('/recipes/import-photo', { image: reader.result });
        setAddModalOpen(false);
        if (res.data.recipe) {
          setRecipeForm(res.data.recipe);
        }
        await loadRecipes();
      } catch {
        setError('Could not import from photo.');
      }
    };
    reader.readAsDataURL(file);
  }

  // Save recipe (manual form)
  async function handleSaveRecipe(data) {
    try {
      if (data.id) {
        await api.patch(`/recipes/${data.id}`, data);
      } else {
        await api.post('/recipes', data);
      }
      setRecipeForm(null);
      await loadRecipes();
    } catch {
      setError('Could not save recipe.');
    }
  }

  return (
    <>
      {/* Search */}
      <div className="relative">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cocoa" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search recipes..."
          className="w-full pl-9 pr-3 py-2.5 border border-cream-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* Category filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => { setCatFilter(''); setFavOnly(false); }}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !catFilter && !favOnly ? 'bg-primary text-white' : 'bg-oat text-cocoa hover:bg-secondary/30'
          }`}
        >
          All
        </button>
        <button
          onClick={() => { setFavOnly(!favOnly); setCatFilter(''); }}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            favOnly ? 'bg-primary text-white' : 'bg-oat text-cocoa hover:bg-secondary/30'
          }`}
        >
          ⭐ Favourites
        </button>
        {MEAL_CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => { setCatFilter(catFilter === cat ? '' : cat); setFavOnly(false); }}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              catFilter === cat ? 'bg-primary text-white' : 'bg-oat text-cocoa hover:bg-secondary/30'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Dietary tag filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {DIETARY_TAGS.map(tag => (
          <button
            key={tag}
            onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tagFilter === tag ? 'bg-sage text-white' : 'bg-oat text-cocoa hover:bg-secondary/30'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <>
          {/* Recipe grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {recipes.map(recipe => {
              const colors = getCatColours(recipe.category);
              return (
                <button
                  key={recipe.id}
                  onClick={() => setDetailRecipe(recipe)}
                  className="bg-linen rounded-2xl  border border-cream-border p-4 text-left hover: transition-shadow"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-bark truncate">{recipe.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg ${colors.bg} ${colors.text} capitalize`}>{recipe.category}</span>
                        {recipe.prep_time_mins && <span className="text-xs text-cocoa">Prep: {recipe.prep_time_mins}m</span>}
                        {recipe.cook_time_mins && <span className="text-xs text-cocoa">Cook: {recipe.cook_time_mins}m</span>}
                      </div>
                    </div>
                    <button
                      onClick={e => toggleFavourite(recipe, e)}
                      className="text-lg shrink-0 transition-transform hover:scale-110"
                      title={(recipe.is_favourite || recipe.favourite) ? 'Remove favourite' : 'Add favourite'}
                    >
                      {(recipe.is_favourite || recipe.favourite) ? '⭐' : '☆'}
                    </button>
                  </div>
                  {(recipe.dietary_tags || recipe.tags)?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(recipe.dietary_tags || recipe.tags).map(tag => (
                        <span key={tag} className="text-[10px] font-medium bg-oat text-cocoa px-2 py-0.5 rounded-full">{tag}</span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {recipes.length === 0 && (
            <div className="text-center py-8">
              <p className="text-cocoa text-sm mb-4">No recipes found. Add your first recipe!</p>
              <button
                onClick={() => setAddModalOpen(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-pressed text-white rounded-xl text-sm font-medium transition-colors"
              >
                <IconPlus className="h-4 w-4" /> Add your first recipe
              </button>
            </div>
          )}
        </>
      )}

      {/* Add recipe FAB */}
      <button
        onClick={() => setAddModalOpen(true)}
        className="fixed bottom-24 md:bottom-8 right-24 md:right-24 bg-primary hover:bg-primary-pressed text-white w-14 h-14 rounded-2xl flex items-center justify-center transition-colors z-20"
        title="Add recipe"
      >
        <IconPlus className="h-6 w-6" />
      </button>

      {/* Add Recipe Modal */}
      {addModalOpen && (
        <AddRecipeModal
          onClose={() => setAddModalOpen(false)}
          onManual={() => { setAddModalOpen(false); setRecipeForm({ name: '', category: 'Dinner', servings: 4, ingredients: [{ name: '', quantity: '', unit: '' }], method: '', prep_time: '', cook_time: '', tags: [], notes: '' }); }}
          importUrl={importUrl}
          setImportUrl={setImportUrl}
          onImportUrl={handleImportUrl}
          importingUrl={importingUrl}
          aiDescription={aiDescription}
          setAiDescription={setAiDescription}
          onAiGenerate={handleAiGenerate}
          generatingAi={generatingAi}
          onPhotoImport={handlePhotoImport}
        />
      )}

      {/* Manual Recipe Form */}
      {recipeForm && (
        <RecipeFormModal
          recipe={recipeForm}
          onSave={handleSaveRecipe}
          onClose={() => setRecipeForm(null)}
        />
      )}

      {/* Recipe Detail */}
      {detailRecipe && (
        <RecipeDetailModal
          recipe={detailRecipe}
          onClose={() => setDetailRecipe(null)}
          onEdit={() => { setRecipeForm(detailRecipe); setDetailRecipe(null); }}
          onDelete={() => deleteRecipe(detailRecipe.id)}
          setError={setError}
          onRefresh={loadRecipes}
        />
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// Add Recipe Modal (import options)
// ══════════════════════════════════════════════════════════════════

function AddRecipeModal({ onClose, onManual, importUrl, setImportUrl, onImportUrl, importingUrl, aiDescription, setAiDescription, onAiGenerate, generatingAi, onPhotoImport }) {
  const modalRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (modalRef.current && !modalRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div ref={modalRef} className="bg-linen w-full sm:w-[460px] sm:rounded-2xl rounded-t-2xl  border border-cream-border max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-bark">Add Recipe</h3>
          <button onClick={onClose} className="text-cocoa hover:text-bark p-1 transition-colors">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Import from URL */}
          <div className="bg-white rounded-xl border border-cream-border p-4">
            <h4 className="text-sm font-semibold text-bark mb-2">🌐 Import from URL</h4>
            <div className="flex gap-2">
              <input
                type="url"
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                placeholder="https://recipe-site.com/recipe..."
                className="flex-1 border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                onClick={onImportUrl}
                disabled={importingUrl || !importUrl.trim()}
                className="px-4 py-2.5 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-xl text-sm font-medium transition-colors whitespace-nowrap"
              >
                {importingUrl ? '...' : 'Import'}
              </button>
            </div>
          </div>

          {/* Generate with AI */}
          <div className="bg-white rounded-xl border border-cream-border p-4">
            <h4 className="text-sm font-semibold text-bark mb-2">✨ Generate with AI</h4>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiDescription}
                onChange={e => setAiDescription(e.target.value)}
                placeholder="Describe a dish, e.g. 'quick chicken stir fry'..."
                className="flex-1 border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                onClick={onAiGenerate}
                disabled={generatingAi || !aiDescription.trim()}
                className="px-4 py-2.5 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-xl text-sm font-medium transition-colors whitespace-nowrap"
              >
                {generatingAi ? '...' : 'Create'}
              </button>
            </div>
          </div>

          {/* Import from photo */}
          <div className="bg-white rounded-xl border border-cream-border p-4">
            <h4 className="text-sm font-semibold text-bark mb-2">📷 Import from photo</h4>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onPhotoImport}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-2.5 border border-dashed border-cream-border rounded-xl text-sm text-cocoa hover:border-primary hover:text-primary transition-colors"
            >
              Choose image...
            </button>
          </div>

          {/* Manual */}
          <button
            onClick={onManual}
            className="w-full bg-white rounded-xl border border-cream-border p-4 text-left hover: transition-shadow"
          >
            <h4 className="text-sm font-semibold text-bark">✎ Add manually</h4>
            <p className="text-xs text-cocoa mt-0.5">Enter recipe details yourself</p>
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Recipe Form Modal (manual / edit)
// ══════════════════════════════════════════════════════════════════

function RecipeFormModal({ recipe, onSave, onClose }) {
  const [name, setName] = useState(recipe.name || '');
  const [category, setCategory] = useState((recipe.category || 'dinner').charAt(0).toUpperCase() + (recipe.category || 'dinner').slice(1));
  const [servings, setServings] = useState(recipe.servings || 4);
  const [ingredients, setIngredients] = useState(
    recipe.ingredients?.length > 0 ? recipe.ingredients : [{ name: '', quantity: '', unit: '' }]
  );
  const [method, setMethod] = useState(
    Array.isArray(recipe.method) ? recipe.method.join('\n') : (recipe.method || '')
  );
  const [prepTime, setPrepTime] = useState(recipe.prep_time_mins || recipe.prep_time || '');
  const [cookTime, setCookTime] = useState(recipe.cook_time_mins || recipe.cook_time || '');
  const [tags, setTags] = useState(recipe.dietary_tags || recipe.tags || []);
  const [notes, setNotes] = useState(recipe.notes || '');
  const [saving, setSaving] = useState(false);
  const modalRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (modalRef.current && !modalRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  function updateIngredient(index, field, value) {
    const updated = [...ingredients];
    updated[index] = { ...updated[index], [field]: value };
    setIngredients(updated);
  }

  function addIngredient() {
    setIngredients([...ingredients, { name: '', quantity: '', unit: '' }]);
  }

  function removeIngredient(index) {
    if (ingredients.length <= 1) return;
    setIngredients(ingredients.filter((_, i) => i !== index));
  }

  function toggleTag(tag) {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const data = {
      ...(recipe.id ? { id: recipe.id } : {}),
      name: name.trim(),
      category: category.toLowerCase(),
      servings: Number(servings) || 4,
      ingredients: ingredients.filter(i => i.name.trim()),
      method: method.trim(),
      prep_time_mins: prepTime ? Number(prepTime) : null,
      cook_time_mins: cookTime ? Number(cookTime) : null,
      dietary_tags: tags,
      notes: notes.trim() || null,
    };
    await onSave(data);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div ref={modalRef} className="bg-linen w-full sm:w-[540px] sm:rounded-2xl rounded-t-2xl  border border-cream-border max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-cream-border flex items-center justify-between shrink-0">
          <h3 className="text-lg font-bold text-bark">{recipe.id ? 'Edit Recipe' : 'New Recipe'}</h3>
          <button onClick={onClose} className="text-cocoa hover:text-bark p-1 transition-colors">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-bark mb-1.5">Recipe name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              required
            />
          </div>

          {/* Category + Servings row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-bark mb-1.5">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {MEAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-bark mb-1.5">Servings</label>
              <input
                type="number"
                min="1"
                value={servings}
                onChange={e => setServings(e.target.value)}
                className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <label className="block text-xs font-medium text-bark mb-1.5">Ingredients</label>
            <div className="space-y-2">
              {ingredients.map((ing, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={ing.name}
                    onChange={e => updateIngredient(i, 'name', e.target.value)}
                    placeholder="Ingredient"
                    className="flex-1 border border-cream-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <input
                    type="text"
                    value={ing.quantity}
                    onChange={e => updateIngredient(i, 'quantity', e.target.value)}
                    placeholder="Qty"
                    className="w-16 border border-cream-border rounded-xl px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <select
                    value={ing.unit}
                    onChange={e => updateIngredient(i, 'unit', e.target.value)}
                    className="w-20 border border-cream-border rounded-xl px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {UNITS.map(u => <option key={u} value={u}>{u || 'unit'}</option>)}
                  </select>
                  {ingredients.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeIngredient(i)}
                      className="text-error hover:text-error/80 shrink-0 p-1 transition-colors"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addIngredient}
              className="mt-2 text-xs font-medium text-primary hover:underline"
            >
              + Add ingredient
            </button>
          </div>

          {/* Method */}
          <div>
            <label className="block text-xs font-medium text-bark mb-1.5">Method</label>
            <textarea
              value={method}
              onChange={e => setMethod(e.target.value)}
              rows={5}
              placeholder="Step-by-step instructions..."
              className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent resize-none"
            />
          </div>

          {/* Prep + Cook time */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-bark mb-1.5">Prep time (mins)</label>
              <input
                type="number"
                min="0"
                value={prepTime}
                onChange={e => setPrepTime(e.target.value)}
                className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-bark mb-1.5">Cook time (mins)</label>
              <input
                type="number"
                min="0"
                value={cookTime}
                onChange={e => setCookTime(e.target.value)}
                className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {/* Dietary tags */}
          <div>
            <label className="block text-xs font-medium text-bark mb-1.5">Dietary tags</label>
            <div className="flex flex-wrap gap-2">
              {DIETARY_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    tags.includes(tag) ? 'bg-sage text-white' : 'bg-oat text-cocoa hover:bg-secondary/30'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-bark mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Tips, variations..."
              className="w-full border border-cream-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-oat hover:bg-cream-border text-bark rounded-xl text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 py-3 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-xl text-sm font-medium transition-colors"
            >
              {saving ? 'Saving...' : recipe.id ? 'Update Recipe' : 'Save Recipe'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Recipe Detail Modal
// ══════════════════════════════════════════════════════════════════

function RecipeDetailModal({ recipe: initialRecipe, onClose, onEdit, onDelete, setError, onRefresh }) {
  const [recipe, setRecipe] = useState(initialRecipe);
  const [servingsMultiplier, setServingsMultiplier] = useState(1);
  const [checkedIngredients, setCheckedIngredients] = useState(new Set());
  const [addingToList, setAddingToList] = useState(false);
  const [shoppingListResult, setShoppingListResult] = useState(null);
  const [addingToPlan, setAddingToPlan] = useState(false);
  const [planDay, setPlanDay] = useState('');
  // If recipe is a Dessert, default to Dinner since Dessert isn't a meal plan slot
  const [planCategory, setPlanCategory] = useState(
    PLAN_CATEGORIES.includes(recipe.category) ? recipe.category : 'Dinner'
  );
  const modalRef = useRef(null);

  const baseServings = recipe.servings || 4;
  const currentServings = Math.round(baseServings * servingsMultiplier);

  // Load full recipe details
  useEffect(() => {
    async function loadFull() {
      try {
        const res = await api.get(`/recipes/${initialRecipe.id}`);
        if (res.data.recipe) setRecipe(res.data.recipe);
      } catch {
        // use what we have
      }
    }
    if (initialRecipe.id) loadFull();
  }, [initialRecipe.id]);

  useEffect(() => {
    function handleClick(e) {
      if (modalRef.current && !modalRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  function toggleIngredient(i) {
    setCheckedIngredients(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function adjustServings(delta) {
    setServingsMultiplier(prev => Math.max(0.25, prev + delta));
  }

  function scaleQuantity(qty) {
    if (!qty) return qty;
    const num = parseFloat(qty);
    if (isNaN(num)) return qty;
    const scaled = num * servingsMultiplier;
    return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(1);
  }

  async function addIngredientsToList() {
    setAddingToList(true);
    try {
      // Post ingredients to shopping list via the recipe
      const res = await api.post('/meals/to-shopping-list', { recipe_id: recipe.id, servings_multiplier: servingsMultiplier });
      setShoppingListResult(res.data);
    } catch {
      setError('Could not add ingredients to shopping list.');
    } finally {
      setAddingToList(false);
    }
  }

  async function addToPlan() {
    if (!planDay) return;
    setAddingToPlan(true);
    try {
      await api.post('/meals', { date: planDay, category: planCategory.toLowerCase(), recipe_id: recipe.id, meal_name: recipe.name });
      alert('Added to meal plan!');
      setAddingToPlan(false);
      setPlanDay('');
    } catch {
      setError('Could not add to meal plan.');
      setAddingToPlan(false);
    }
  }

  const colors = getCatColours(recipe.category);

  // Get this week's dates for "Add to plan" picker
  const thisMonday = getMonday(new Date());
  const weekDates = getWeekDates(thisMonday);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div ref={modalRef} className="bg-linen w-full sm:w-[540px] sm:rounded-2xl rounded-t-2xl  border border-cream-border max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className={`px-5 py-4 ${colors.bg} sm:rounded-t-2xl shrink-0`}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <span className={`text-xs font-semibold ${colors.text} uppercase tracking-wide`}>{recipe.category}</span>
              <h3 className="text-lg font-bold text-bark mt-1">{recipe.name}</h3>
              {recipe.source_url && (
                <a href={recipe.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-1 block truncate">
                  Source: {recipe.source_url}
                </a>
              )}
            </div>
            <button onClick={onClose} className="text-bark/60 hover:text-bark p-1 transition-colors shrink-0">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-bark/70">
            {recipe.prep_time_mins && <span>Prep: {recipe.prep_time_mins}min</span>}
            {recipe.cook_time_mins && <span>Cook: {recipe.cook_time_mins}min</span>}
          </div>
          {(recipe.dietary_tags || recipe.tags)?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(recipe.dietary_tags || recipe.tags).map(tag => (
                <span key={tag} className="text-[10px] font-medium bg-white/60 text-bark/70 px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Servings adjuster */}
          <div className="flex items-center gap-3 bg-oat rounded-xl px-4 py-2.5">
            <span className="text-sm font-medium text-bark">Servings:</span>
            <button onClick={() => adjustServings(-0.5)} className="w-7 h-7 rounded-full bg-white border border-cream-border text-bark flex items-center justify-center text-sm font-bold hover:bg-cream-border transition-colors">-</button>
            <span className="text-sm font-semibold text-bark w-6 text-center">{currentServings}</span>
            <button onClick={() => adjustServings(0.5)} className="w-7 h-7 rounded-full bg-white border border-cream-border text-bark flex items-center justify-center text-sm font-bold hover:bg-cream-border transition-colors">+</button>
            {servingsMultiplier !== 1 && (
              <button onClick={() => setServingsMultiplier(1)} className="text-xs text-primary hover:underline ml-1">Reset</button>
            )}
          </div>

          {/* Ingredients */}
          {recipe.ingredients?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-bark mb-2">Ingredients</h4>
              <ul className="space-y-1.5">
                {recipe.ingredients.map((ing, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <button
                      onClick={() => toggleIngredient(i)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        checkedIngredients.has(i) ? 'bg-success border-success text-white' : 'border-cream-border hover:border-primary'
                      }`}
                    >
                      {checkedIngredients.has(i) && <span className="text-xs">✓</span>}
                    </button>
                    <span className={`text-sm ${checkedIngredients.has(i) ? 'line-through text-cocoa' : 'text-bark'}`}>
                      {scaleQuantity(ing.quantity) && <span className="font-medium">{scaleQuantity(ing.quantity)}</span>}
                      {ing.unit && <span> {ing.unit}</span>}
                      {(ing.quantity || ing.unit) && <span> </span>}
                      {ing.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Method */}
          {recipe.method && (
            <div>
              <h4 className="text-sm font-semibold text-bark mb-2">Method</h4>
              <ol className="space-y-3">
                {(Array.isArray(recipe.method) ? recipe.method : recipe.method.split('\n')).filter(s => s.trim()).map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">{i + 1}</span>
                    <span className="text-cocoa leading-relaxed">{step.replace(/^\d+\.\s*/, '')}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Notes */}
          {recipe.notes && (
            <div>
              <h4 className="text-sm font-semibold text-bark mb-2">Notes</h4>
              <p className="text-sm text-cocoa">{recipe.notes}</p>
            </div>
          )}

          {/* Add to plan */}
          <div className="bg-oat rounded-xl p-4 space-y-3">
            <h4 className="text-sm font-semibold text-bark">Add to this week's plan</h4>
            <div className="flex gap-2">
              <select
                value={planDay}
                onChange={e => setPlanDay(e.target.value)}
                className="flex-1 border border-cream-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">Select day...</option>
                {weekDates.map((d, i) => (
                  <option key={i} value={toDateStr(d)}>{DAY_HEADERS[i]} {d.getDate()}</option>
                ))}
              </select>
              <select
                value={planCategory}
                onChange={e => setPlanCategory(e.target.value)}
                className="w-28 border border-cream-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {PLAN_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button
              onClick={addToPlan}
              disabled={!planDay || addingToPlan}
              className="w-full py-2.5 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-xl text-sm font-medium transition-colors"
            >
              {addingToPlan ? 'Adding...' : 'Add to Plan'}
            </button>
          </div>

          {/* Shopping list result */}
          {shoppingListResult && (
            <div className="bg-white rounded-xl border border-cream-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-bark">Shopping List Updated</h4>
                <button onClick={() => setShoppingListResult(null)} className="text-xs text-cocoa hover:text-bark">Dismiss</button>
              </div>
              <p className="text-xs text-cocoa">{shoppingListResult.summary}</p>
              {shoppingListResult.added?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-bark mb-1">Added ({shoppingListResult.added.length}):</p>
                  <ul className="space-y-1">
                    {shoppingListResult.added.map((item, i) => (
                      <li key={i} className="text-xs text-cocoa bg-success/10 rounded-lg px-2.5 py-1.5">
                        {item.quantity && <span className="font-medium">{item.quantity}</span>}
                        {item.unit && <span> {item.unit}</span>}
                        {(item.quantity || item.unit) && <span> </span>}
                        {item.item || item.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {shoppingListResult.skipped?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-cocoa mb-1">Skipped ({shoppingListResult.skipped.length}):</p>
                  <ul className="space-y-1">
                    {shoppingListResult.skipped.map((item, i) => (
                      <li key={i} className="text-xs text-cocoa/70 bg-oat/50 rounded-lg px-2.5 py-1.5">
                        {item.item || item.name}{item.reason && <span className="ml-1">({item.reason})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-cream-border">
            {recipe.ingredients?.length > 0 && (
              <button
                onClick={addIngredientsToList}
                disabled={addingToList}
                className="flex-1 min-w-[140px] py-2.5 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                {addingToList ? 'Adding...' : 'Add ingredients to list'}
              </button>
            )}
            <button
              onClick={onEdit}
              className="px-4 py-2.5 bg-oat hover:bg-cream-border text-bark rounded-xl text-sm font-medium transition-colors"
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              className="px-4 py-2.5 text-error hover:bg-error/10 rounded-xl text-sm font-medium transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
