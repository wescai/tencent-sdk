import Joi from 'joi';
import {
  Capi,
  CapiInstance,
  CapiOptions,
  RequestData,
} from '@tencent-sdk/capi';

class HttpError extends Error {
  message: string = '';
  code: number = 0;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.message = message;
  }
}

const CheckExistsFromError = (err: Error) => {
  if (err && err.message.match('does not exist')) {
    return false;
  }
  if (err && err.message.match('not found')) {
    return false;
  }
  return true;
};

type ApiGwRequestData = Omit<RequestData, 'Action'>;
type ApiGwOptions = Omit<CapiOptions, 'ServiceType'>;

interface ApiObject {
  [propName: string]: (
    data: ApiGwRequestData,
    options?: ApiGwOptions,
    isV3?: boolean,
  ) => Promise<any>;
}

export class ApiGwRequest {
  // support action list
  private actionList: string[] = [
    'CreateService',
    'DeleteService',
    'DescribeService',
    'ReleaseService',
    'UnReleaseService',
    'CreateApi',
    'DescribeApi',
    'DeleteApi',
    'ModifyApi',
    'DescribeApisStatus',
    'CreateUsagePlan',
    'DescribeApiUsagePlan',
    'DescribeUsagePlanSecretIds',
    'DescribeUsagePlan',
    'DeleteUsagePlan',
    'ModifyUsagePlan',
    'CreateApiKey',
    'DeleteApiKey',
    'DisableApiKey',
    'EnableApiKey',
    'DescribeApiKeysStatus',
    'BindSecretIds',
    'UnBindSecretIds',
    'BindEnvironment',
    'UnBindEnvironment',
  ];
  // action need check exist error
  private needCheckAction: string[] = [
    'UnBindSecretIds',
    'UnBindEnvironment',
    'DeleteUsagePlan',
    'DeleteApiKey',
  ];

  apiRequest: CapiInstance;
  apis: ApiObject = {};

  constructor(options: ApiGwOptions) {
    this.apiRequest = new Capi({
      ...options,
      ...{
        ServiceType: 'apigateway',
      },
    });

    this.apiFactory();
  }

  async request(
    Action: string,
    data: ApiGwRequestData,
    options: ApiGwOptions | undefined,
    isV3: boolean | undefined = false,
    needCheck: boolean = false,
  ) {
    try {
      const res = await this.apiRequest.request(
        {
          Action,
          ...data,
        } as RequestData,
        {
          ...(options || {}),
          ...{
            path: '/v2/index.php',
          },
        },
        isV3,
      );

      if (res.code !== 0) {
        if (needCheck) {
          if (CheckExistsFromError(res)) {
            throw new HttpError(res.code, res.message);
          }
        } else {
          throw new HttpError(res.code, res.message);
        }
      }
      return res;
    } catch (err) {
      throw err;
    }
  }

  apiFactory() {
    this.apis = {};
    this.actionList.forEach((item: string) => {
      this.apis[item] = (
        data: ApiGwRequestData,
        options?: ApiGwOptions,
        isV3?: boolean,
      ) => {
        return this.request(
          item,
          data,
          options,
          isV3,
          this.needCheckAction.indexOf(item) !== -1,
        );
      };
    });
  }
}

export const Validate = (config: object = {}) => {
  const usagePlanScheme = {
    usagePlanId: Joi.string().optional(),
    usagePlanDesc: Joi.string()
      .max(200)
      .optional(),
    maxRequestNum: Joi.number()
      .integer()
      .min(1)
      .max(99999999)
      .optional()
      .default(-1),
    maxRequestNumPreSec: Joi.number()
      .integer()
      .min(1)
      .max(2000)
      .optional()
      .default(1000),
    usagePlanName: Joi.string()
      .min(2)
      .max(50)
      .required()
      .error(new Error('"usagePlan.usagePlanName" is required')),
  };

  // Api returns a maximum of 100 rows of records at a time
  const endpointsScheme = Joi.array()
    .max(100)
    .items(
      Joi.object().keys({
        apiId: Joi.string().optional(),
        description: Joi.string()
          .max(200)
          .optional(),
        enableCORS: Joi.boolean()
          .optional()
          .default(false),
        path: Joi.string().required(),
        method: Joi.string()
          .regex(/^(GET|POST|PUT|DELETE|HEAD|ANY)$/)
          .required(),
        function: Joi.object()
          .keys({
            isIntegratedResponse: Joi.boolean()
              .optional()
              .default(false),
            functionQualifier: Joi.string()
              .optional()
              .default('$LATEST'),
            functionName: Joi.string()
              .required()
              .error(
                new Error('"endpoints.function.functionName" is required'),
              ),
          })
          .required(),
        usagePlan: Joi.object().keys(usagePlanScheme),
        auth: {
          serviceTimeout: Joi.number()
            .integer()
            .optional()
            .default(15),
          secretName: Joi.string().required(),
          // Api returns a maximum of 100 rows of records at a time
          // https://cloud.tencent.com/document/product/628/14920
          secretIds: Joi.array().max(100),
        },
      }),
    )
    .required();

  const globalScheme = Joi.object()
    .keys({
      region: Joi.string()
        .optional()
        .default('ap-guangzhou'),
      serviceId: Joi.string().optional(),
      protocol: Joi.string()
        .regex(/^(http|https|http&https)$/)
        .optional()
        .default('http'),
      serviceName: Joi.string()
        .min(2)
        .max(50)
        .required()
        .error(new Error('"serviceName" is required')),
      description: Joi.string()
        .max(200)
        .optional(),
      environment: Joi.string()
        .regex(/^(prepub|test|release)$/)
        .optional()
        .default('release'),
      endpoints: endpointsScheme,
      // usagePlan: Joi.object().keys(usagePlanScheme)
    })
    .options({ allowUnknown: true });

  const gloalResult = Joi.validate(config, globalScheme);
  if (gloalResult.error) {
    throw gloalResult.error;
  }

  return gloalResult.value;
};
