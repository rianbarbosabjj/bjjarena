// Registration closure is authoritative; the deadline alone does not release brackets.
export const canViewPublicBrackets = event => event?.status === 'closed';
export const publicEventTabs = event => [
  ['informacoes', 'Informações'], ['edital', 'Edital'], ['checagem', 'Checagem de atletas'],
  ...(canViewPublicBrackets(event) ? [['chaves', 'Chaves e resultados']] : []),
];
export const resolvePublicEventTab = (event, requested) =>
  requested === 'chaves' && !canViewPublicBrackets(event) ? 'checagem' : requested;
