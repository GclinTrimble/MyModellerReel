// The sign-in screen (#115). The main process loads the app itself once a session exists.
const native = window.native;
const theme = localStorage.getItem('mymodellerreel.theme');
document.documentElement.classList.toggle('dark', theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);

function button(label, id, cls, ph, onclick) {
  const b = document.createElement('button');
  b.className = cls;
  b.id = id;
  b.onclick = onclick;
  if (ph) b.innerHTML = `<i class="ph ph-${ph}" aria-hidden="true"></i>`;
  b.append(label);
  return b;
}

function apply(s) {
  const waiting = document.createElement('span');
  waiting.textContent = 'Finish signing in in your browser';
  document.getElementById('signin-action').replaceChildren(
    ...(s.signingIn
      ? [waiting, button('Cancel', 'signin-cancel', 'btn', null, () => native.invoke('account:cancel'))]
      : [button('Sign in with Google', 'signin-google', 'btn primary', 'user-circle', () => native.invoke('account:sign-in').then(apply))]),
  );
  const problem = document.getElementById('signin-problem');
  problem.textContent = s.problem || '';
  problem.hidden = !s.problem;
}

native.onAccount(apply);
apply(await native.invoke('account:status'));
