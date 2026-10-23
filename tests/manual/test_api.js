import fetch from "node-fetch";

async function test() {
  try {
    const res = await fetch("http://localhost:5003/api/helpdesk/ipd-final-bill/68427f717c1bf25a62dd9eb2"); // I need to get the real patientId.
  } catch (e) {
    console.log(e);
  }
}
test();
