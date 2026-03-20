export type IpfsUploadResult = {
  cid: string;
  uri: string;
};

export type IpfsJsonUploader = (payload: unknown) => Promise<IpfsUploadResult>;

type PinataResponse = {
  IpfsHash: string;
};

export function createPinataJsonUploader(pinataJwt: string): IpfsJsonUploader {
  return async (payload: unknown): Promise<IpfsUploadResult> => {
    const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${pinataJwt}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`IPFS upload failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as PinataResponse;
    if (!data?.IpfsHash) {
      throw new Error("IPFS upload failed: missing IpfsHash");
    }

    return {
      cid: data.IpfsHash,
      uri: `ipfs://${data.IpfsHash}`
    };
  };
}

export function createIpfsUploaderFromEnv(): IpfsJsonUploader {
  const pinataJwt = process.env.PINATA_JWT ?? "";
  if (!pinataJwt) {
    throw new Error("Missing PINATA_JWT for IPFS upload");
  }
  return createPinataJsonUploader(pinataJwt);
}
