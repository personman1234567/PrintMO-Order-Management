// Compatibility only: earlier Order Manager links now use the existing website review.
const id=new URL(location.href).searchParams.get('order');
if(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||'')){
  (async()=>{try{
    const response=await fetch('https://order-manager-proxy.printmobusiness.workers.dev/order-manager/v1/prepared-orders/public/'+id,{credentials:'omit',cache:'no-store'});
    const result=await response.json();if(!response.ok)throw Error('This order link could not open. Ask Print-MO for a new link.');
    const url=new URL(result.order.url);
    if(url.origin!=='https://print-mo.com'||url.pathname!=='/pages/designer-studio'||url.searchParams.get('preparedOrder')!==id)throw Error('The order address could not be verified.');
    document.getElementById('continue').href=url.href;location.replace(url.href);
  }catch(error){document.getElementById('message').textContent=error.message}})();
}else document.getElementById('message').textContent='This order link is invalid. Ask Print-MO for a new link.';
