import * as core from "@actions/core";
import { Config, S3 } from "aws-sdk";
import { readFileSync } from "fs";
import { basename, join } from "path";
import { AWSHelper } from "./aws";
import { checkFileExist, toPosixPath } from "./utils";

process.env["AWS_OUTPUT"] = "json";

async function run() {
  const begin = Date.now();
  const bucket = core.getInput("aws_bucket_name", { required: true });

  const source = core.getInput("source", { required: true });
  let prefix = core.getInput("aws_bucket_dir") ?? "";
  prefix = toPosixPath(prefix).replace(/^\//, "");
  const compare = core.getInput("compare").toLowerCase() === "true";
  const acl = core.getInput("acl");
  const filename = core.getInput("filename");
  const distributionId = core.getInput("aws_cloudfront_distribution_id");

  // check path
  const fileName = basename(source);
  const key = toPosixPath(join(prefix, filename || fileName));

  // create s3
  const credentials = await AWSHelper.GetCredentials();
  const config = new Config({
    credentials,
  });
  const s3 = new S3(config);

  // compare files

  let needUpload = true;
  const file = readFileSync(source);
  if (compare) {
    core.info(`[Time:Compare:Begin]: ${Date.now() - begin}`);

    const hasSameFile = await AWSHelper.CompareETag(s3, bucket, key, file);
    needUpload = !hasSameFile;
    core.info(`[Time:Compare:End]: ${Date.now() - begin}`);
  }

  if (!needUpload) {
    core.warning("Nothing need to upload after compare Etag");
    return;
  }

  // upload
  core.info(`[Time:Upload:Begin]: ${Date.now() - begin}`);
  const data = await AWSHelper.UploadFile(s3, bucket, key, file, acl);
  core.info(`Uploaded: ${source} To: ${key}`);
  core.info(JSON.stringify(data, null, 2));
  core.info(`[Time:Upload:End]: ${Date.now() - begin}`);

  // create invalidation
  if (distributionId) {
    core.info(`[Time:Invalidation:Begin]: ${Date.now() - begin}`);
    try {
      const data = await AWSHelper.CreateInvalidation(distributionId, [key]);
      core.info("Invalidation Created.");
      core.setOutput("invalidation_id", data.Invalidation?.Id);
      core.info(JSON.stringify(data, null, 2));
    } catch (error) {
      core.warning("Create invalidation failed");
      core.warning(error.message);
    } finally {
      core.info(`[Time:Invalidation:End]: ${Date.now() - begin}`);
    }
  }

  core.info(`[Time:End]: ${Date.now() - begin}`);
}

run().catch((error) => {
  core.setFailed(error.message);
});
