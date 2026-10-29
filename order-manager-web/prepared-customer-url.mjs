// Explicit internal-test action only. Never persist this mode on the customer link.
export const PREPARED_TEST_THEME_ID='163707977976';
export function preparedCustomerUrl(value,testing=false) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='print-mo.com'||url.pathname!=='/pages/designer-studio')throw new Error('The customer address could not be verified. Open the order and retry.');
  url.searchParams.delete('preview_theme_id');
  if(testing)url.searchParams.set('preview_theme_id',PREPARED_TEST_THEME_ID);
  return url.href;
}
