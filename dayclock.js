// A constant, quiet reminder of how much of today is actually left: the current
// time plus a countdown to midnight. Visible everywhere in the app, not just the
// road, since the point is a nudge to act, not a fact about any one goal.

const dayClockEl = document.getElementById("dayClock");
const dayClockTimeEl = dayClockEl.querySelector(".day-clock-time");
const dayClockLeftEl = dayClockEl.querySelector(".day-clock-left");

// Whether there's still something today owes an answer for. Mirrors the same
// per-goal rule the desktop notification uses (main.py's remind()), so the clock
// and the toast never disagree about what counts as "done for today".
function hasUnfinishedToday(data) {
  if (!data || !data.goals) return false;
  const today = todayISO();
  return data.goals.some((g) => {
    const mode = g.mode || "steps";
    if (mode === "clean") return false; // nothing daily to close out here
    if (mode === "number") return (g.log || {})[today] === undefined;
    return (g.steps || []).some((s) => !s.done) && !(g.checkins || []).includes(today);
  });
}

function updateDayClock() {
  const now = new Date();
  dayClockTimeEl.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msLeft = midnight - now;
  const hoursLeft = Math.floor(msLeft / 3600000);
  const minutesLeft = Math.floor((msLeft % 3600000) / 60000);

  const parts = [];
  if (hoursLeft) parts.push(`${hoursLeft} ${plural(hoursLeft, "час", "часа", "часов")}`);
  parts.push(`${minutesLeft} ${plural(minutesLeft, "минута", "минуты", "минут")}`);
  const shortLeft = hoursLeft ? `${hoursLeft} ч ${minutesLeft} мин` : `${minutesLeft} мин`;
  dayClockLeftEl.innerHTML = `<span class="dc-long">до конца дня ${parts.join(" ")}</span><span class="dc-short">осталось ${shortLeft}</span>`;

  // urgent only when time is short AND something today is still waiting — being
  // late in the evening after everything's already checked off isn't a reason to alarm
  dayClockEl.classList.toggle("low", hoursLeft < 2 && hasUnfinishedToday(typeof lastData !== "undefined" ? lastData : null));
}

// deferred to DOMContentLoaded rather than run at parse time: this script loads
// before goalplan.js, which is where plural() is defined
window.addEventListener("DOMContentLoaded", updateDayClock);
setInterval(updateDayClock, 15000);
