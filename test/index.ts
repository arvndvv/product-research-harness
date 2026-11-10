/**
 * Tests run without any API keys. The model is replaced with a scripted fake
 * (setChatImpl), which is how you test harness logic deterministically.
 * Run: npm test
 */
import "./units.test.ts";
import "./loop.test.ts";
import "./pipeline.test.ts";
import "./profile.test.ts";
import "./intake.test.ts";
import "./pricing.test.ts";
import "./brief.test.ts";
import "./stop.test.ts";
import "./metrics.test.ts";
import "./settings.test.ts";
import "./accuracy.test.ts";
