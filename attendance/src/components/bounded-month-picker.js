import {createCompactSelect} from './compact-select.js';

/** A width-bound, keyboard accessible month dropdown which preserves the
 * original native select as the authoritative change-event source. */
export function createBoundedMonthPicker(nativeSelect,{maxHeight=180}={}){
  nativeSelect.hidden=true;
  nativeSelect.setAttribute('aria-hidden','true');
  nativeSelect.tabIndex=-1;
  const widget=createCompactSelect({
    options:[],value:nativeSelect.value,
    placeholder:'בחר חודש',ariaLabel:'חודש דיווח',maxHeight
  });
  widget.wrap.classList.add('av2-report__bounded-month-picker');
  widget.select.addEventListener('change',()=>{
    nativeSelect.value=widget.select.value;
    nativeSelect.dispatchEvent(new Event('change',{bubbles:true}));
  });
  function sync(){
    widget.setOptions([...nativeSelect.options].map(opt=>({
      value:opt.value,label:opt.textContent||opt.label
    })));
    widget.select.value=nativeSelect.value;
    widget.select.disabled=nativeSelect.disabled;
  }
  sync();
  return {wrap:widget.wrap,sync};
}
