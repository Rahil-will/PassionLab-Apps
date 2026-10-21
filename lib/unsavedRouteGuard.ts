/** Block a route change while the page still has unsaved edits. */
export function unsavedRouteGuard(isUnsaved: boolean): 'block' | 'pass' {
  return isUnsaved ? 'block' : 'pass';
}
