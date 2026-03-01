#!/usr/bin/env node
import bcrypt from "bcryptjs";

async function main() {
	const args = process.argv.slice(2);
	const password = args[0] ?? process.env["PASSWORD"];
	if (!password) {
		console.error("Usage: npx ts-node backend/src/scripts/createPassword.ts <password> [saltRounds]");
		process.exit(2);
	}

	const saltRoundsArg = args[1];
	const saltRounds = saltRoundsArg ? parseInt(saltRoundsArg, 10) : 12;
	if (Number.isNaN(saltRounds) || saltRounds <= 0) {
		console.error("saltRounds must be a positive integer");
		process.exit(2);
	}

	try {
		const hash = await bcrypt.hash(password, saltRounds);
		// Print only the hash so it's easy to copy-paste into env
		console.log(hash);
	} catch (err) {
		console.error("Hash generation failed:", err);
		process.exit(1);
	}
}

main();

