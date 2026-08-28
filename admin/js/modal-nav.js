// admin/js/modal-nav.js
//
// Problem this solves: on mobile, pressing the browser/Android back button
// while a modal is open normally navigates away from the page (or closes the
// tab) instead of closing the modal. It also made it possible to open a
// second modal (e.g. Delete confirm) on top of a first one (e.g. Add product)
// with no way back except closing the tab.
//
// Fix: every time a modal opens, we push a history entry. The back button
// then triggers `popstate`, which closes the top-most open modal instead of
// leaving the page. Modals are tracked as a stack, so nested/stacked modals
// close one at a time, back button press by back button press.
//
// Usage in a page's JS:
//   openModalWithBackSupport(closeModalFn);   // call when you show a modal
//   requestCloseModal();                      // call from Cancel/X/backdrop
//                                              // click, INSTEAD OF calling
//                                              // your close function directly
//
// Your actual close function (the one that hides the modal element) should
// only be called by this helper — from openModalWithBackSupport's popstate
// listener — so there's a single source of truth for "a modal just closed."

const _modalStack = [];

function openModalWithBackSupport(closeFn) {
  _modalStack.push(closeFn);
  history.pushState({ adminModalDepth: _modalStack.length }, document.title);
}

function requestCloseModal() {
  if (_modalStack.length === 0) return;
  history.back(); // triggers popstate below, which does the actual closing
}

window.addEventListener('popstate', () => {
  const closeFn = _modalStack.pop();
  if (closeFn) closeFn();
});
