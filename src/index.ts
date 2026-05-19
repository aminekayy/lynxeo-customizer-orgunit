import {
    Context,
    createConnectorCustomizer,
    ConnectorError,
    readConfig,
    logger,
    StdAccountReadInput,
    StdAccountCreateInput,
    StdAccountReadOutput,
    StdTestConnectionOutput,
    createConnectorHttpClient,
} from '@sailpoint/connector-sdk'

// Connector customizer must be exported as module property named connectorCustomizer
export const connectorCustomizer = async () => {
    type ConnectionParameter = {
        operationType?: string
        header?: {
          Authorization?: string
          [key: string]: string | undefined
        }
      }
    // Get connector source config
    const config = await readConfig()

    const baseUrl =
    config.genericWebServiceBaseUrl ||
    config.connectorAttributes?.genericWebServiceBaseUrl
    
    const connectionParameters =
      config.connectionParameters ||
      config.connectorAttributes?.connectionParameters ||
      []
    
    const createAccountOperation = connectionParameters.find(
      (p: ConnectionParameter) => p.operationType === 'Create Account'
    )
    
    const authorization = createAccountOperation?.header?.Authorization
    
    return createConnectorCustomizer()
    .beforeStdAccountCreate(async (context: Context, input: StdAccountCreateInput) => {
        //logger.info('Running beforeStdAccountCreate customizer')
        //logger.info(`Create account input before customizer: ${JSON.stringify(input.attributes)}`)

        if (!input.attributes) {
          throw new ConnectorError('Missing attributes in account create input')
        }
  
        input.attributes.OrganizationalUnit = ''

        const contractSiteCode = String(input.attributes.contractSiteCode ?? '').trim()
        const actualLocationCode = String(input.attributes.actualLocationCode ?? '').trim()
        logger.info(`contractSiteCode present: ${Boolean(contractSiteCode)}`)
        logger.info(`actualLocationCode present: ${Boolean(actualLocationCode)}`)

        if (!contractSiteCode || !actualLocationCode) {
          logger.info('Skipping OrganizationalUnit lookup because contractSiteCode or actualLocationCode is empty')
          return input
        }

        if (!baseUrl || !authorization) {
          logger.info('Skipping OrganizationalUnit lookup because base URL or Authorization header is missing')
          return input
        }

        const httpClient = createConnectorHttpClient({
          baseURL: baseUrl,
          headers: {
            Authorization: authorization,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        })

        const organizationalUnitName = `${contractSiteCode}-${actualLocationCode}`
  
        logger.info('Computed OrganizationalUnit name from contractSiteCode and actualLocationCode')
  
        const filter = `Name eq '${organizationalUnitName.replace(/'/g, "''")}'`
  
        try {
          const response = await httpClient.get(
            '/api/odata/businessobject/organizationalunits',
            {
              params: {
                '$filter': filter,
                '$select': 'RecId',
              },
            }
          )

          const recId = response?.status === 200 ? response.data?.value?.[0]?.RecId : undefined

          if (recId && String(recId).trim() !== '') {
            input.attributes.OrganizationalUnit = recId
            logger.info(`OrganizationalUnit RecId resolved: ${Boolean(recId)}`)
          } else {
            logger.info('OrganizationalUnit lookup did not return a 200 response with a RecId')
          }
        } catch (error) {
          logger.info('OrganizationalUnit lookup failed; leaving OrganizationalUnit empty')
        }
  
        //logger.info('OrganizationalUnit RecId resolved and added to account create input')
        logger.info(`Create account input after customizer: ${JSON.stringify(input.attributes)}`)
  
  // TEMPORARY DEBUG STOP
  // This proves the GET works and the plan is computed,
  // but prevents the actual Create Account POST from happening.
  // throw new ConnectorError(
  //   `DEBUG STOP - Create Account blocked intentionally. Computed OU name: ${organizationalUnitName}, resolved RecId: ${recId}`
  // )

  // Enable this later when you want real provisioning:
  return input
      })
        // TODO: Create Account provisioning customization — call external endpoint, enrich attributes, return modified payload
        .afterStdTestConnection(async (context: Context, output: StdTestConnectionOutput) => {
            logger.info('Running after test connection')
            return output
        })
        // TODO: calculate/enrich attribute before account read
        .beforeStdAccountRead(async (context: Context, input: StdAccountReadInput) => {
            logger.info(`Running before account, for account ${input.identity}`)
            return input
        })
        .afterStdAccountRead(async (context: Context, output: StdAccountReadOutput) => {
            logger.info(`Running after account read to add custom attribute "location"`)
            // TODO: call external endpoint and return modified payload per SailPoint customizer pattern

            output.attributes.location = 'Austin'
            return output
        })
}
