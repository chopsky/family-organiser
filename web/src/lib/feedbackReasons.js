// Mirrors src/services/feedback.js EXIT_REASONS - keys are what the server
// stores, labels are what the person sees in the delete-account modal.
export const EXIT_REASONS = [
  { key: 'not_what_hoped',    label: "It didn't do what I hoped" },
  { key: 'too_much_setup',    label: 'Too much effort to set up' },
  { key: 'family_didnt_join', label: "The rest of the family didn't use it" },
  { key: 'forgot',            label: 'I forgot it was there' },
  { key: 'found_better',      label: 'I found something else that worked better' },
  { key: 'other',             label: 'Something else' },
];
